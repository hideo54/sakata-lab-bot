import { NodeSSH } from 'node-ssh';

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
const bot_password = process.env.TI_BOT_PASSWORD;

const ports = {
    ti01: 10022,
    ti02: 20022,
    ti03: 30022,
    ti04: 40022,
    ti05: 50022,
};

const range = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, i) => start + i);

const optionsForSudo = {
    stdin: bot_password + '\n',
    execOptions: {
        pty: true,
    },
};

const intersectionAll = (arrays: number[][]): number[] =>
    arrays.length === 0
        ? []
        : arrays.reduce((acc, curr) => acc.filter((num) => curr.includes(num)));

const getUserIdIfExists = async (connection: NodeSSH, username: string) => {
    const passwdFileStr = await connection.exec('cat', ['/etc/passwd']);
    const passwdFileLines = passwdFileStr.split('\n');
    const usernames = passwdFileLines.map(line => line.split(':')[0]);
    if (usernames.includes(username)) {
        const line = passwdFileLines.find(line => line.includes(username + ':'));
        if (!line) return null;
        const [,, uid] = line.split(':');
        return Number(uid);
    }
    return null;
};

const findAvailableIds = async (connection: NodeSSH) => {
    const passwdFileStr = await connection.exec('cat', ['/etc/passwd']);
    const reservedUidAndGids = passwdFileStr.split('\n').map(line => {
        const [,, uid, gid] = line.split(':');
        return [Number(uid), Number(gid)];
    });
    const availableIds = range(1100, 2000).filter(id => !reservedUidAndGids.some(([uid, gid]) => uid === id || gid === id));
    return availableIds;
};

export const createUser = async (username: string, hosts: (keyof typeof ports)[]) => {
    const availableIdsDict: {[key: string]: number[]} = {};
    const connections: {[key: string]: NodeSSH} = {};

    const ssh = new NodeSSH();
    const proxyConnection = await ssh.connect({
        ...proxyInfo,
        ...privateKeyInfo,
    });
    console.log('Connected to the proxy.');

    for (const host of hosts) {
        const stream = await proxyConnection.forwardOut('127.0.0.1', ports[host], ti_ip, ports[host]);
        const connection = await ssh.connect({
            ...privateKeyInfo,
            sock: stream,
            host: ti_ip,
            username: bot_username,
            port: ports[host],
        });
        console.log(`Connected to ${host}.`);
        connections[host] = connection;

        const uid = await getUserIdIfExists(connection, username);

        if (uid) {
            console.log(`User ${username} already exists on ${host}.`);
            availableIdsDict[host] = [uid];
        } else {
            const availableIds = await findAvailableIds(connection);
            availableIdsDict[host] = availableIds;
        }
    }

    const id = intersectionAll(Object.values(availableIdsDict))[0];
    const successfulHosts: string[] = [];

    for (const host of hosts) {
        const connection = connections[host];

        if (availableIdsDict[host].length === 1) {
            console.log(`User ${username} already exists on ${host}.`);
            continue;
        }

        await connection.exec('sudo', ['-S', 'groupadd', '-g', String(id), username], optionsForSudo);
        await connection.exec('sudo', ['-S',
            'adduser', username,
            '-uid', String(id),
            '-gid', String(id),
            '--disabled-password',
            '--gecos', '""',
        ], optionsForSudo);
        await connection.exec('sudo', ['-S', 'usermod', '-a', '-G', 'docker', username], optionsForSudo);
        console.log(`Created user ${username} (UID & GID: ${id}) on ${host}.`);

        await connection.exec('sudo', ['-S', 'mkdir', `/home/${username}/.ssh`], optionsForSudo);
        await connection.exec('sudo', ['-S', 'chown', `${username}:${username}`, `/home/${username}/.ssh`], optionsForSudo);
        await connection.exec('sudo', ['-S', 'chmod', '700', `/home/${username}/.ssh`], optionsForSudo);
        await connection.exec('sudo', ['-S', 'touch', `/home/${username}/.ssh/authorized_keys`], optionsForSudo);
        await connection.exec('sudo', ['-S', 'chown', `${username}:${username}`, `/home/${username}/.ssh/authorized_keys`], optionsForSudo);
        await connection.exec('sudo', ['-S', 'chmod', '600', `/home/${username}/.ssh/authorized_keys`], optionsForSudo);

        connection.dispose();
        proxyConnection.dispose();

        successfulHosts.push(host);
    }
    console.log('Done.');
    return { successfulHosts, id };
};

export const addPublicKey = async (username: string, publicKey: string, hosts: (keyof typeof ports)[]) => {
    const ssh = new NodeSSH();
    const proxyConnection = await ssh.connect({
        ...proxyInfo,
        ...privateKeyInfo,
    });
    console.log('Connected to the proxy.');

    const successfulHosts: string[] = [];

    for (const host of hosts) {
        try {
            const stream = await proxyConnection.forwardOut('127.0.0.1', ports[host], ti_ip, ports[host]);
            const connection = await ssh.connect({
                ...privateKeyInfo,
                sock: stream,
                host: ti_ip,
                username: bot_username,
                port: ports[host],
            });
            console.log(`Connected to ${host}.`);


            await connection.exec('sudo', ['bash', '-c', `echo "${publicKey}" >> /home/${username}/.ssh/authorized_keys`], optionsForSudo);
            console.log(`Added public key to ${username} on ${host}.`);

            connection.dispose();
            proxyConnection.dispose();

            successfulHosts.push(host);
        } catch (error) {
            console.error(error);
        }
    }
    console.log('Done.');
    return { successfulHosts };
};
