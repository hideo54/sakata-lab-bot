import type { App, KnownBlock } from '@slack/bolt';
import axios, { type AxiosError } from 'axios';
import dayjs from 'dayjs';
import qs from 'qs';
import { scrapeHTML } from 'scrape-it';
import { notifyAllBigNotebooks } from './jupyter-sessions';

const stigmatized_mem_usage_threshold = 10;

const headers = {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    'X-Api-Key': process.env.MACKEREL_API_KEY!,
};

const getPlay2AuthSessId = async () => {
    const getCookie = (cookieStrs: string[] | undefined, targetKey: string) => cookieStrs?.find(s => s.startsWith(`${targetKey}=`))?.split(';')?.[0].split('=')?.[1];
    const getSignInRes = await axios.get('https://mackerel.io/signin');
    const playSession = getCookie(getSignInRes.headers['set-cookie'], 'PLAY_SESSION');
    const { csrfToken } = scrapeHTML<{
        csrfToken: string;
    }>(getSignInRes.data, {
        csrfToken: {
            selector: 'input[name="csrfToken"]',
            attr: 'value',
        },
    });
    const play2AuthSessId = await axios.post(
        'https://mackerel.io/signin',
        {
            email: process.env.MACKEREL_USER_EMAIL,
            password: process.env.MACKEREL_USER_PASSWORD,
            csrfToken,
        },
        {
            headers: {
                // 'Content-Type': 'application/x-www-form-urlencoded',
                Cookie: `PLAY_SESSION=${playSession}; timezoneName=Asia%2FTokyo`,
                // Referer: 'https://mackerel.io/signin',
            },
            maxRedirects: 0,
        },
    ).catch(({ response }: AxiosError) =>
        getCookie(
            response?.headers['set-cookie'],
            'PLAY2AUTH_SESS_ID'
        )
    );
    return play2AuthSessId;
};

const getTopMemConsumers = async (hostId: string) => {
    const { data: allMetricsData } = await axios.get<{
        names: string[];
    }>(`https://api.mackerelio.com/api/v0/hosts/${hostId}/metric-names`, {
        headers,
    });
    const userMemMetricNames = allMetricsData.names.filter(name => name.startsWith('custom.user_mem.'));
    const { data: allTsdbData } = await axios.get<{
        tsdbLatest: {
            [key: string]: {
                [key: string]: {
                    time: number;
                    value: number;
                } | null;
            }
        }
    }>('https://api.mackerelio.com/api/v0/tsdb/latest', {
        params: {
            hostId,
            name: userMemMetricNames,
        },
        paramsSerializer: params => qs.stringify(params, { arrayFormat: 'repeat' }),
        headers,
    });
    const top = Object.entries(allTsdbData.tsdbLatest[hostId])
        .map(([k, v]) => [k, v?.value] as const)
        .filter(([, v]) => v !== undefined && v > stigmatized_mem_usage_threshold)
        .sort((a, b) => - ((a[1] as number) - (b[1] as number)))
        .slice(0, 3);
    return top;
};

const createMemConsumerDisplayBlocks = async (hostId: string, hostname: string, prefixLines: string[]) => {
    const blocks: KnownBlock[] = [];
    const topMemConsumers = await getTopMemConsumers(hostId);
    const lines = [
        ...prefixLines,
        `*${hostname}* のメモリ使用量が多いユーザーを発表するよ〜 :loudspeaker:`,
        ...topMemConsumers.map(([metricName, memPercent]) =>
            `*${metricName.replace('custom.user_mem.', '')}: ${memPercent?.toFixed(1)}%*`
        ),
        '余分にカーネルを立ち上げている人は停止してね!',
    ];
    blocks.push({
        type: 'section',
        text: {
            type: 'mrkdwn',
            text: lines.join('\n'),
        },
    });
    const now = dayjs();
    const nowStr = now.toISOString().slice(0, -5) + 'Z';
    const pastStr = now.subtract(3, 'hour').toISOString().slice(0, -5) + 'Z';
    const play2AuthSessId = await getPlay2AuthSessId();
    const imageUrl = `https://asia-northeast1-hideo54.cloudfunctions.net/sakataLabBot/mackerel/graphs/${hostId}/custom.user_mem.*`
        + `?PLAY2AUTH_SESS_ID=${play2AuthSessId}`
        + `&t=${pastStr},${nowStr}`;
    const imageAvailable = await axios.get(imageUrl).then(() => true).catch(() => false);
    if (imageAvailable) {
        blocks.push({
            type: 'image',
            title: {
                type: 'plain_text',
                text: 'Memory usage by users',
                emoji: true,
            },
            image_url: imageUrl,
            alt_text: 'Memory usage by users',
        });
    } else {
        blocks.push({
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    text: `Image Unavailable; reset PLAY2AUTH_SESS_ID. <@${process.env.SLACK_HIDEO54_USERID!}>`,
                },
            ],
        });
    }
    return blocks;
};

// https://mackerel.io/ja/docs/entry/howto/alerts/webhook
type AlertBody = {
    orgName: string;
    event: 'alert' | 'sample';
    type: 'connectivity' | 'host' | 'service' | 'external' | 'check' | 'expression' | 'anomalyDetection';
    message: string;
    host: {
        id: string;
        name: string;
        url: string;
        status: 'working' | 'standby' | 'poweroff' | 'maintenance';
        memo: string;
        isRetired: boolean;
        roles: {
            fullname: string;
            serviceName: string;
            serviceUrl: string;
            roleName: string;
            roleUrl: string;
        }[];
    };
    alert: {
        id: string;
        status: 'ok' | 'warning' | 'critical' | 'unknown';
        isOpen: boolean;
        trigger: 'monitoring' | 'manual' | 'monitorDelete' | 'hostRetire';
        url: string;
        openedAt: number;
        closedAt: number;
        /** @deprecated */
        createdAt: number;
        monitorName: string;
        metricLabel: string;
        metricValue: number;
        criticalThreshold: number;
        warningThreshold: number;
        monitorOperator: '>' | '<';
        duration: number;
    };
};

const func = async ({ body, slackApp, slackChannel }: {
    body: AlertBody;
    slackApp: App;
    slackChannel: string;
}) => {
    if (body.event === 'sample') {
        slackApp.client.chat.postMessage({
            channel: slackChannel,
            text: body.message,
        });
    }
    if (body.event === 'alert' && body.alert.status === 'critical') {
        const blocks = await createMemConsumerDisplayBlocks(body.host.id, body.host.name, [
            `:rotating_light: *${body.host.name}* のメモリ使用量が${(body.alert.metricValue).toFixed(1)}% に達しているよ :fearful:`,
        ]);
        slackApp.client.chat.postMessage({
            channel: slackChannel,
            text: 'メモリ使用量が多いユーザーを発表するよ〜 :loudspeaker:',
            blocks,
        });
        notifyAllBigNotebooks({
            host: body.host.name,
            slackApp,
            slackChannel,
        });
    }
};

export default func;
