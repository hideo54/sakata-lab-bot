import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { scrapeHTML } from 'scrape-it';
import { notifyAllBigNotebooks } from './jupyter-sessions';
import { uploadMackerelGraph } from './storage';

const stigmatized_mem_usage_threshold = 10;

const headers = {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  'X-Api-Key': process.env.MACKEREL_API_KEY!,
};

const getPlay2AuthSessId = async () => {
  const getCookie = (cookieStrs: string[] | undefined, targetKey: string) =>
    cookieStrs
      ?.find((s) => s.startsWith(`${targetKey}=`))
      ?.split(';')?.[0]
      .split('=')?.[1];
  const getSignInRes = await fetch('https://mackerel.io/signin');
  const playSession = getCookie(
    getSignInRes.headers.getSetCookie(),
    'PLAY_SESSION',
  );
  const { csrfToken } = scrapeHTML<{
    csrfToken: string;
  }>(await getSignInRes.text(), {
    csrfToken: {
      selector: 'input[name="csrfToken"]',
      attr: 'value',
    },
  });
  // A successful sign-in responds with a redirect; we read the PLAY2AUTH_SESS_ID
  // cookie from that response instead of following it.
  const signInRes = await fetch('https://mackerel.io/signin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `PLAY_SESSION=${playSession}; timezoneName=Asia%2FTokyo`,
    },
    body: JSON.stringify({
      email: process.env.MACKEREL_USER_EMAIL,
      password: process.env.MACKEREL_USER_PASSWORD,
      csrfToken,
    }),
    redirect: 'manual',
  });
  return getCookie(signInRes.headers.getSetCookie(), 'PLAY2AUTH_SESS_ID');
};

const getTopMemConsumers = async (hostId: string) => {
  const allMetricsData = (await (
    await fetch(
      `https://api.mackerelio.com/api/v0/hosts/${hostId}/metric-names`,
      {
        headers,
      },
    )
  ).json()) as { names: string[] };
  const userMemMetricNames = allMetricsData.names.filter((name) =>
    name.startsWith('custom.user_mem.'),
  );
  const tsdbParams = new URLSearchParams({ hostId });
  for (const name of userMemMetricNames) {
    tsdbParams.append('name', name);
  }
  const allTsdbData: {
    tsdbLatest: {
      [key: string]: {
        [key: string]: {
          time: number;
          value: number;
        } | null;
      };
    };
  } = await (
    await fetch(`https://api.mackerelio.com/api/v0/tsdb/latest?${tsdbParams}`, {
      headers,
    })
  ).json();
  const top = Object.entries(allTsdbData.tsdbLatest[hostId])
    .map(([k, v]) => [k, v?.value] as const)
    .filter(([, v]) => v !== undefined && v > stigmatized_mem_usage_threshold)
    .sort((a, b) => -((a[1] as number) - (b[1] as number)))
    .slice(0, 3);
  return top;
};

const createMemConsumerDisplayBlocks = async (
  hostId: string,
  hostname: string,
  prefixLines: string[],
) => {
  const blocks: KnownBlock[] = [];
  const topMemConsumers = await getTopMemConsumers(hostId);
  const lines = [
    ...prefixLines,
    `*${hostname}* のメモリ使用量が多いユーザーを発表するよ〜 :loudspeaker:`,
    ...topMemConsumers.map(
      ([metricName, memPercent]) =>
        `*${metricName.replace('custom.user_mem.', '')}: ${memPercent?.toFixed(1)}%*`,
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
  const play2AuthSessId = await getPlay2AuthSessId();
  const publicImageUrl = await uploadMackerelGraph({ hostId, play2AuthSessId });
  if (publicImageUrl) {
    blocks.push({
      type: 'image',
      title: {
        type: 'plain_text',
        text: 'Memory usage by users',
        emoji: true,
      },
      image_url: publicImageUrl,
      alt_text: 'Memory usage by users',
    });
  }
  return blocks;
};

// https://mackerel.io/ja/docs/entry/howto/alerts/webhook
type AlertBody = {
  orgName: string;
  event: 'alert' | 'sample';
  type:
    | 'connectivity'
    | 'host'
    | 'service'
    | 'external'
    | 'check'
    | 'expression'
    | 'anomalyDetection';
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

const func = async ({
  body,
  slackApp,
  slackChannel,
}: {
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
    const blocks = await createMemConsumerDisplayBlocks(
      body.host.id,
      body.host.name,
      [
        `:rotating_light: *${body.host.name}* のメモリ使用量が${body.alert.metricValue.toFixed(1)}% に達しているよ :fearful:`,
      ],
    );
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
