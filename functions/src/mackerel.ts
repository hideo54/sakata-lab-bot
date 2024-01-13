import type { App, KnownBlock } from '@slack/bolt';
import axios from 'axios';
import qs from 'qs';

const stigmatized_mem_usage_threshold = 10;

const headers = {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    'X-Api-Key': process.env.MACKEREL_API_KEY!,
};

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const play2authSessId = process.env.MACKEREL_PLAY2AUTH_SESS_ID!;

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

const createMemConsumerDisplayBlocks = async (hostId: string, hostname: string) => {
    const blocks: KnownBlock[] = [];
    const topMemConsumers = await getTopMemConsumers(hostId);
    const lines = [
        `*${hostname}* のメモリ使用量が多いユーザーを発表するよ〜 :loudspeaker:`,
        ...topMemConsumers.map(([metricName, memPercent]) =>
            `*${metricName.replace('custom.user_mem.', '')}: ${memPercent?.toFixed(1)}%*`
        ),
    ];
    blocks.push({
        type: 'section',
        text: {
            type: 'mrkdwn',
            text: lines.join('\n'),
        },
    });
    const imageUrl = `https://asia-northeast1-hideo54.cloudfunctions.net/sakataLabBot/mackerel/graphs/${hostId}/custom.user_mem.*?PLAY2AUTH_SESS_ID=${play2authSessId}`;
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
        const blocks = await createMemConsumerDisplayBlocks(body.host.id, body.host.name);
        slackApp.client.chat.postMessage({
            channel: slackChannel,
            text: `${body.host.name} のメモリ使用量が多いユーザーを発表するよ〜 :loudspeaker:`,
            blocks,
        });
    }
};

export default func;
