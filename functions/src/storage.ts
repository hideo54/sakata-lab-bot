import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import dayjs from 'dayjs';

const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
});

const createCookieString = (cookieObject: object) =>
    Object.entries(cookieObject)
        .map(
            ([key, value]) =>
                `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
        )
        .join('; ');

export const uploadMackerelGraph = async ({
    hostId,
    play2AuthSessId,
}: {
    hostId: string;
    play2AuthSessId?: string;
}) => {
    if (!play2AuthSessId) {
        console.error(
            'No PLAY2AUTH_SESS_ID available, cannot upload Mackerel graph.',
        );
        return null;
    }
    try {
        const now = dayjs();
        const nowStr = now.toISOString().slice(0, -5) + 'Z';
        const pastStr =
            now.subtract(3, 'hour').toISOString().slice(0, -5) + 'Z';
        const params = new URLSearchParams({
            graph: 'custom.user_mem.*',
            t: `${pastStr},${nowStr}`,
        });
        const mackerelRes = await fetch(
            `https://mackerel.io/embed/orgs/sakata-lab/hosts/${hostId}.png?${params}`,
            {
                headers: {
                    Cookie: createCookieString({
                        timezoneName: 'Asia/Tokyo',
                        PLAY2AUTH_SESS_ID: play2AuthSessId,
                    }),
                },
            },
        );
        if (!mackerelRes.ok) {
            console.error(`Mackerel responded with ${mackerelRes.status}`);
            return null;
        }
        const imageBuffer = Buffer.from(await mackerelRes.arrayBuffer());
        const objectPath = `sakata-lab/mackerel/${now.toISOString()}.png`;
        await r2.send(
            new PutObjectCommand({
                Bucket: 'img',
                Key: objectPath,
                Body: imageBuffer,
                ContentType: 'image/png',
            }),
        );
        return `https://img.hideo54.com/${objectPath}`;
    } catch (e) {
        console.error('Failed to upload Mackerel graph to R2:', e);
        return null;
    }
};
