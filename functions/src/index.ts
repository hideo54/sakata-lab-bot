import * as functions from 'firebase-functions';
import { App, ExpressReceiver } from '@slack/bolt';
import express from 'express';
import dotenv from 'dotenv';
dotenv.config();
import slackEvents from './slack-events';

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const randomChannel = process.env.SLACK_RANDOM_CHANNEL!;

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

const server = express();

slackEvents({
    slackApp,
    receiver,
    channel: randomChannel,
});

server.use('/slack/events', receiver.router);

export const sakataLabBot = functions
    .region('asia-northeast1')
    .https.onRequest(server);
