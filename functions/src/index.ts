import * as functions from 'firebase-functions';
import admin from 'firebase-admin'; // Default import required
import { getFirestore } from 'firebase-admin/firestore';
import { App, ExpressReceiver } from '@slack/bolt';
import dotenv from 'dotenv';
dotenv.config();
import facultyNews from './facultyNews';
import notifier from './notifier';

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const randomChannel = process.env.SLACK_RANDOM_CHANNEL!;
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const facultyNewsChannel = process.env.SLACK_FACULTY_NEWS_CHANNEL!;

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

export const tmiSlackHourlyJob = functions
    .region('asia-northeast1')
    .pubsub.schedule('0 * * * *')
    .timeZone('Asia/Tokyo')
    .onRun(async () => {
        admin.initializeApp();
        const firestoreDb = getFirestore();
        await facultyNews({ slackApp, firestoreDb, channel: facultyNewsChannel });
    });

export const tmiSlackEventsReceiver = functions
    .region('asia-northeast1')
    .https.onRequest(
        notifier({
            slackApp,
            receiver,
            channel: randomChannel,
        })
    );
