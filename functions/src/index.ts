import { App, ExpressReceiver } from '@slack/bolt';
import axios from 'axios';
import bodyParser from 'body-parser';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import dotenv from 'dotenv';
dotenv.config();

import mackerel from './mackerel';
import slackEvents from './slack-events';
import { notifyUnusedBigNotebooks } from './jupyter-sessions';

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const randomChannel = process.env.SLACK_RANDOM_CHANNEL!;
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const serverChannel = process.env.SLACK_SERVER_CHANNEL!;

const receiver = new ExpressReceiver({
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
    processBeforeResponse: true,
    customPropertiesExtractor: req => ({
        Headers: req.headers,
    }),
});
const slackApp = new App({
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    token: process.env.SLACK_TOKEN!,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
    receiver,
    processBeforeResponse: true,
});

const server = receiver.app;
server.use(bodyParser.urlencoded({ extended: true }));
server.use(bodyParser.json());

server.use((req, res, next) => {
    // https://api.slack.com/apis/connections/events-api#retries
    if (req.headers['X-Slack-Retry-Reason'] === 'http_timeout') {
        res.status(200).send('Your previous request was actually accepted and no need to retry.');
    }
    next();
});

slackEvents({
    slackApp,
    receiver,
    channel: randomChannel,
});

server.post('/mackerel', (req, res) => {
    mackerel({
        body: req.body,
        slackApp,
        slackChannel: serverChannel,
    });
    res.status(200).send('OK');
});

const createCookieString = (cookieObject: object) =>
    Object.entries(cookieObject).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('; ');

// Mackerel Graph Proxy
server.get('/mackerel/graphs/:hostId/:metricLabel', async (req, res) => {
    const { hostId, metricLabel } = req.params;
    const { PLAY2AUTH_SESS_ID, ...query } = req.query;
    try {
        const mackerelRes = await axios.get(`https://mackerel.io/embed/orgs/sakata-lab/hosts/${hostId}.png`, {
            params: {
                graph: metricLabel,
                ...query,
            },
            headers: {
                Cookie: createCookieString({
                    timezoneName: 'Asia/Tokyo',
                    PLAY2AUTH_SESS_ID,
                }),
            },
            responseType: 'arraybuffer',
        });
        res.setHeader('Content-Type', mackerelRes.headers['content-type']);
        res.send(mackerelRes.data);
    } catch (e) {
        res.status(500).send('Error');
    }
});

setGlobalOptions({
    region: 'asia-northeast1',
});

export const sakataLabBot = onRequest({
    timeoutSeconds: 180,
}, server);
export const sakataLabBotScheduler = onSchedule({
    schedule: 'every day 16:00',
    timeZone: 'Asia/Tokyo',
    timeoutSeconds: 180,
}, async () => {
    await notifyUnusedBigNotebooks({
        slackApp,
        slackChannel: serverChannel,
    });
});
