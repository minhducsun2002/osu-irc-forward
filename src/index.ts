import { BanchoClient } from 'bancho.js';
import { Client, TextChannel, MessageMentions, Intents } from 'discord.js';
import { config } from 'dotenv'; config();
import safe from 'url-regex-safe';
import { Inhibitor } from './whitelisting';

const { IRC_USERNAME, IRC_PASSWORD, TARGET_CHANNELS, TRACKED_CHANNELS, DISCORD_TOKEN, OSU_API_KEY } = process.env;
const bancho = new BanchoClient({ username: IRC_USERNAME, password: IRC_PASSWORD, apiKey: OSU_API_KEY });
const client = new Client({
    sweepers: {
        messages: {
            lifetime: 1,
            interval: 1
        }
    },
    restSweepInterval: 1,
    intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES]
});

const inhibitor = new Inhibitor(client);

function panic(error? : string) { if (error) console.error(error); process.exit(1); }
function log(s : string) { console.log(`${new Date().toJSON()} | ${s}`); }

client
    .once('ready', async () => {
        log(`Logged in as ${client.user.username}#${client.user.discriminator}.`);

        let channels = await Promise.all(TARGET_CHANNELS.split(',').map(_ => _.trim())
            .map(channelId => client.channels.fetch(channelId).catch(console.log))) as TextChannel[];

        if (!channels.filter(ch => ch instanceof TextChannel).length) panic(`There's no valid channel ID to push tracked messages to!`);
        let dispatchChannels = channels.filter(ch => ch instanceof TextChannel);

        // padding stuff
        {
            log(`I'll be pushing messages to the following channel${dispatchChannels.length > 1 ? 's' : ''} :`);
            let channelLen = Math.max(...dispatchChannels.map(ch => ch.name.length));
            let guildLen = Math.max(...dispatchChannels.map(ch => ch.guild.name.length))
            dispatchChannels.forEach(ch => log(`- "#${ch.name}"${
                ' '.repeat(channelLen - ch.name.length)
            } [${ch.id}] from "${ch.guild.name}"${
                ' '.repeat(guildLen - ch.guild.name.length)
            } [${ch.guild.id}]`));
        }

        log(`Initializing Bancho client.`);
        bancho.disconnect();
        bancho.removeAllListeners('connected');
        bancho
            .once('connected', async () => {
                log(`Logged into Bancho successfully as ${bancho.getSelf().ircUsername}`);
                let self = await bancho.getSelf().fetchFromAPI();

                // joining channels
                for (let ch of TRACKED_CHANNELS.split(',').map(_ => _.trim()).filter(Boolean).slice(0, 1))
                    bancho.getChannel(ch.trim()).join().catch(() => null)
                bancho.on('CM', msg => {
                    let action = msg.getAction();
                    let { message } = msg;
                    if (action) message = message.replace('ACTION', '').trimStart();
                    // sanitize urls
                    for (let match of message.match(safe()) || []) message = message.replace(match, `<${match}>`);

                    message = message.replace(/@everyone/g, 'at-everyone').replace(/@here/g, 'at-here');

                    let option = inhibitor.cache.get(msg.user.ircUsername.toLowerCase()) ?? { allowIndividualMention: false, allowRoleMention: false };

                    if (!option.allowIndividualMention)
                        message = message.replace(MessageMentions.USERS_PATTERN, 'at-user-$1')

                    if (!option.allowRoleMention)
                        message = message.replace(MessageMentions.ROLES_PATTERN, 'at-role-$1')

                    for (let channel of dispatchChannels) channel.send(`[${msg.user.ircUsername}] ${(action ? `(*)` : '')}${message.trimStart()}`);
                });
                log(`Registered handlers to forward messages.`)
            })
            .connect().catch(e => panic(e));
    })
    .login(DISCORD_TOKEN)
    .catch(e => panic(e));
