import { Client, Message, Permissions, User } from 'discord.js';
import { Model, Schema, Document, createConnection } from 'mongoose';
import mongoose from 'mongoose';


mongoose.set('useNewUrlParser', true);
mongoose.set('useFindAndModify', false);
mongoose.set('useUnifiedTopology', true);


interface WhitelistingEntry extends Document {
    username: string
    allowIndividualMention: boolean,
    allowRoleMention: boolean
}

const schema = new Schema<WhitelistingEntry>({
    username: String,
    allowIndividualMention: Boolean,
    allowRoleMention: Boolean
});

export class Inhibitor {
    ownerID : string = '';
    connection = createConnection(process.env.MONGODB_URI);
    model : Model<WhitelistingEntry>;
    cache = new Map<string, WhitelistingEntry>();

    constructor(client : Client) {
        client.on('message', this.messageHandler.bind(this));
        this.model = this.connection.model('whitelist', schema, 'whitelist');
        this.model.find({}).exec()
            .then(records => {
                for (let record of records)
                    this.cache.set(record.username, record);
                console.log(`Populated ${records.length} records`);
            })
    }

    async messageHandler(m : Message) {
        if (!this.ownerID)
            this.ownerID = await m.client.application.fetch().then(a => a.owner.id);

        const { content, member, author } = m, { BOT_PREFIX } = process.env;
        if (!content.startsWith(BOT_PREFIX)) return;
        if (
            (!member?.permissions.has(Permissions.FLAGS.ADMINISTRATOR))
            && (!(author.id === this.ownerID))
        ) return;

        let pieces = content.split(' ').filter(Boolean).slice(1);
        let [username, option] = pieces;
        if (username)
        {
            username = username.toLowerCase();
            let options = { username } as WhitelistingEntry;
            let out = 'do nothing';
            switch (option) {
                case 'all':
                    options.allowIndividualMention = true;
                    options.allowRoleMention = true;
                    out = 'mention roles & users';
                    break;
                case 'role':
                    options.allowIndividualMention = false;
                    options.allowRoleMention = true;
                    out = 'mention roles only';
                    break;
                case 'one':
                    options.allowIndividualMention = true;
                    options.allowRoleMention = false;
                    out = 'mention users only';
                    break;
            }

            await this.model.findOneAndReplace(
                { username },
                options,
                { upsert: true, new: true }
            ).exec().then(record => {
                this.cache.set(record.username, record);
                m.reply(`Allowed user \`${record.username}\` to ${out}.`);
            })
        }
    }
}