import { App, ExpressReceiver } from '@slack/bolt';
import axios from 'axios';
import bodyParser from 'body-parser';
import * as functions from 'firebase-functions';

import dotenv from 'dotenv';
dotenv.config();

import mackerel from './mackerel';
import slackEvents from './slack-events';

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const randomChannel = process.env.SLACK_RANDOM_CHANNEL!;
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const serverChannel = process.env.SLACK_SERVER_CHANNEL!;

const receiver = new ExpressReceiver({
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
    processBeforeResponse: true,
});
const slackApp = new App({
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    token: process.env.SLACK_TOKEN!,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
    receiver,
    endpoints: '/', // server.use('/slack/events', ...) するので
});

const server = receiver.app;
server.use(bodyParser.urlencoded({ extended: true }));
server.use(bodyParser.json());

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

export const sakataLabBot = functions
    .region('asia-northeast1')
    .https.onRequest(server);
