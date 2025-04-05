import type { App, ExpressReceiver } from '@slack/bolt';
import { addPublicKey, createUser } from './ti';

const func = ({ slackApp, receiver, channel }: {
    slackApp: App;
    receiver: ExpressReceiver,
    channel: string;
}) => {
    // Channel Notifier
    slackApp.event('channel_created', async ({ event, client }) => {
        const { id, creator } = event.channel;
        client.chat.postMessage({
            channel,
            icon_emoji: ':mega:',
            username: 'チャンネルお知らせ',
            text: `<@${creator}>が新しいチャンネル <#${id}> を作成しました :+1:`,
        });
    });
    slackApp.event('channel_unarchive', async ({ event, client }) => {
        const { channel, user } = event;
        client.chat.postMessage({
            channel,
            icon_emoji: ':mega:',
            username: 'チャンネルお知らせ',
            text: `<@${user}>がチャンネル <#${channel}> を復元しました :+1:`,
        });
    });

    // Emoji Notifier
    slackApp.event('emoji_changed', async ({ event, client }) => {
        let text = '';
        if (event.subtype === 'add') {
            text = `絵文字 :${event.name}: \`:${event.name}:\` が追加されました :+1:`;
        }
        if (event.subtype === 'remove') {
            text = `絵文字 ${event.names?.map(name =>
                '`:' + name + ':`'
            ).join(', ')} が削除されました :wave:`;
        }
        if (event.subtype === 'rename') {
            text = `絵文字 :${event.new_name}: の名前が \`:${event.old_name}:\` から :${event.new_name}: に変更されました :+1:`;
        }
        client.chat.postMessage({
            channel,
            icon_emoji: ':mega:',
            username: '絵文字お知らせ',
            text,
        });
    });

    slackApp.command('/create-ti-account', async ({ command, ack, respond }) => {
        await ack({
            response_type: 'in_channel',
        });
        const { text } = command;
        const username = text.trim().split(' ')[0].normalize('NFKC');
        const args = text.trim().split(' ').slice(1);
        const supportedHosts = [
            'ti01',
            'ti02',
            'ti03',
            'ti04',
            'ti05',
        ] as const;
        const defaultHosts: typeof supportedHosts[number][] = [
            'ti01',
            // 'ti02', // limited use only
            'ti03',
            'ti04',
            'ti05',
        ];
        const specifiedHosts = supportedHosts.filter(host => args.includes(host));
        const hosts = specifiedHosts.length > 0 ? specifiedHosts : defaultHosts;

        const { successfulHosts, id } = await createUser(username, hosts);
        if (successfulHosts.length === 0) {
            respond({
                text: `ユーザー ${username} の作成に失敗しました`,
                response_type: 'in_channel',
            });
        } else {
            respond({
                text: `ユーザー ${username} を ${hosts.join(', ')} に作成しました (UID: ${id})`,
                response_type: 'in_channel',
            });
        }
    });

    slackApp.command('/add-public-key', async ({ command, ack, respond }) => {
        await ack({
            response_type: 'in_channel',
        });
        const { text } = command;
        const username = text.trim().split(' ')[0];
        const publicKey = text.trim().split(' ').slice(1, 4).join(' ');
        const args = text.trim().split(' ').slice(4);
        const supportedHosts = [
            'ti01',
            'ti02',
            'ti03',
            'ti04',
            'ti05',
        ] as const;
        const defaultHosts: typeof supportedHosts[number][] = [
            'ti01',
            // 'ti02', // limited use only
            'ti03',
            'ti04',
            'ti05',
        ];
        const specifiedHosts = supportedHosts.filter(host => args.includes(host));
        const hosts = specifiedHosts.length > 0 ? specifiedHosts : defaultHosts;

        const { successfulHosts } = await addPublicKey(username, publicKey, hosts);
        if (successfulHosts.length === 0) {
            respond({
                text: '失敗しました… :cry:',
                response_type: 'in_channel',
            });
        } else {
            respond({
                text: `ご指定の鍵を ${hosts.join(', ')} に作成しました :+1:`,
                response_type: 'in_channel',
            });
        }
    });
    return receiver.app;
};

export default func;
