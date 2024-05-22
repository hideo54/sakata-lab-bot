import type { App } from '@slack/bolt';
import { stripIndent } from 'common-tags';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { NodeSSH } from 'node-ssh';
import { scrapeHTML } from 'scrape-it';

import dotenv from 'dotenv';
dotenv.config();

dayjs.extend(timezone);
dayjs.extend(utc);

const privateKeyInfo = {
    privateKey: process.env.TI_PRIVATE_KEY,
    passphrase: process.env.TI_PRIVATE_KEY_PASSPHRASE,
};

const proxyInfo = {
    host: process.env.TI_PROXY_HOST,
    username: process.env.TI_PROXY_USERNAME,
    port: Number(process.env.TI_PROXY_PORT),
};

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const ti_ip = process.env.TI_IP!;
const bot_username = process.env.TI_BOT_USERNAME;

const ports = {
    ti01: 10022,
    ti02: 20022,
    ti03: 30022,
    ti04: 40022,
    ti05: 50022,
};

type Usage = {
    host: string;
    user: string;
    notebookPath: string | undefined;
    executionState: string;
    connections: number;
    lastActivity: string;
    pid: string;
    cpu: number;
    mem: number;
};

type SessionDetail = {
    id: string;
    path: string;
    name: string;
    type: string;
    kernel: {
        id: string;
        name: string;
        last_activity: string;
        execution_state: string;
        connections: number;
    }
    notebook?: {
        path: string;
        name: string;
    }
};

const loginToCollectUsage = async () => {
    const ssh = new NodeSSH();

    const usageData: Usage[] = [];
    for (const [host, port] of Object.entries(ports)) {
        const proxyConnection = await ssh.connect({
            ...proxyInfo,
            ...privateKeyInfo,
        });
        const stream = await proxyConnection.forwardOut('127.0.0.1', port, ti_ip, port);
        const connection = await ssh.connect({
            ...privateKeyInfo,
            sock: stream,
            host: ti_ip,
            username: bot_username,
            port,
        });
        console.log(`Connected to ${host}.`);

        const lines = await connection.exec('ps -eo user:20,args | grep jupyter-lab | grep -v grep', []);
        for (const line of lines.split('\n')) {
            const [user, ...args] = line.split(' ').filter(s => s !== '');
            const password = args.find(s => s.startsWith('--NotebookApp.token='))?.replace('--NotebookApp.token=', '');
            const port = Number(args.find(s => s.startsWith('--port='))?.replace('--port=', ''));
            if (!password || !port) continue;
            const loginHtml = await connection.exec('curl', ['--silent', `http://localhost:${port}/login`]);
            const { xsrf_token } = scrapeHTML<{
                xsrf_token: string;
            }>(loginHtml, {
                xsrf_token: {
                    selector: 'input[name="_xsrf"]',
                    attr: 'value',
                },
            });
            const headers = await connection.exec('curl', [
                '--silent',
                '--dump-header', '-',
                '-X', 'POST',
                '-H', 'Content-Type: application/x-www-form-urlencoded',
                '-H', `Cookie: _xsrf=${xsrf_token}`,
                '-d', `_xsrf=${xsrf_token}&password=${password}`,
                `http://localhost:${port}/login`,
            ]);
            const cookie = headers.split('\n').find(line => line.startsWith('Set-Cookie: '))?.replace('Set-Cookie: ', '').split(';')[0];
            const sessions = JSON.parse(
                await connection.exec('curl', [
                    '--silent',
                    '-H', 'Content-Type: application/json',
                    '-H', `Cookie: ${cookie}`,
                    `http://localhost:${port}/api/sessions`,
                ])
            ) as SessionDetail[];
            for (const session of sessions) {
                const kernelId = session.kernel.id;
                const pid = await connection.exec(`ps aux | grep ${kernelId} | grep -v grep | awk '{print $2}'`, []);
                const psResult = await connection.exec('ps', [
                    '-p', pid,
                    '-o', '%cpu,%mem',
                    '--no-headers',
                ]);
                const [cpu, mem] = psResult.split(' ').filter(s => s !== '').map(s => Number(s));
                usageData.push({
                    host,
                    user,
                    notebookPath: session.notebook?.path,
                    executionState: session.kernel.execution_state,
                    connections: session.kernel.connections,
                    lastActivity: session.kernel.last_activity,
                    pid,
                    cpu,
                    mem,
                });
            }
            console.log('.');
        }

        connection.dispose();
        proxyConnection.dispose();
    }
    ssh.dispose();
    const uniqueUsageData = [...new Map(usageData.map(data => [data.pid, data])).values()];
    return uniqueUsageData;
};

const func = async ({ slackApp, slackChannel }: {
    slackApp: App;
    slackChannel: string;
}) => {
    const usageData = await loginToCollectUsage();
    const bigNotebooks = usageData.filter(data =>
        data.executionState === 'idle'
        && data.mem >= 5
        && data.notebookPath
    ).sort((a, b) => - (a.mem - b.mem));
    const text = stripIndent`
        メモリ食い食い notebook を発表するよ〜 :loudspeaker:
    ` + '\n' + bigNotebooks.map(process => stripIndent`
        * :desktop_computer: ${process.host} :floppy_disk: ${process.mem}% for \`${process.notebookPath}\` by ${process.user}
        最終実行日時: ${dayjs(process.lastActivity).tz('Asia/Tokyo').format('MM月DD日 HH:mm')}
    `).join('\n') + stripIndent`
        うち、しばらく使われていない notebook はこれだよ〜 :loudspeaker:
    ` + '\n' + bigNotebooks.filter(process =>
        dayjs(process.lastActivity) < dayjs().subtract(3, 'days')
    ).map(process => stripIndent`
        * :desktop_computer: ${process.host} :floppy_disk: ${process.mem}% for ${process.notebookPath} by ${process.user} 最終実行日時: ${dayjs(process.lastActivity).tz('Asia/Tokyo').format('MM月DD日 HH:mm')}
    `).join('\n');
    await slackApp.client.chat.postMessage({
        channel: slackChannel,
        text,
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text,
                },
            },
        ],
    });
};

export default func;
