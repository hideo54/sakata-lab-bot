import * as functions from 'firebase-functions';
import { App, ExpressReceiver } from '@slack/bolt';
import express from 'express';
import dotenv from 'dotenv';
dotenv.config();
import notifier from './notifier';

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
});

const server = express();

server.get('/slack', (req, res) => {
    notifier({
        slackApp,
        receiver,
        channel: randomChannel,
    });
});

export const sakataLabBot = functions
    .region('asia-northeast1')
    .https.onRequest(server);
