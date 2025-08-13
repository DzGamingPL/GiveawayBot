require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, ActivityType } = require('discord.js');
const express = require('express');
const ms = require('ms');

const app = express();
const PORT = process.env.PORT || 3000;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

const activeGiveaways = new Map();
const endedGiveaways = new Map();

const commands = [
    {
        name: 'konkurs',
        description: 'Tworzy konkurs.',
        options: [
            { name: 'kanal', type: 7, description: 'kanal gdzie ma byc konkurs', required: true },
            { name: 'czas', type: 3, description: 'czas konkursu (np., 1d, 2h)', required: true },
            { name: 'nagroda', type: 3, description: 'nagroda', required: true },
            { name: 'zwyciezcy', type: 4, description: 'ilosc zwyciezcow', required: true }
        ]
    },
    {
        name: 'zakoncz',
        description: 'zakoncz konkurs wczesniej',
        options: [
            { name: 'message_id', type: 3, description: 'id wiadomosci konkursu', required: true }
        ]
    },
    {
        name: 'reroll',
        description: 'reroll konkursu',
        options: [
            { name: 'message_id', type: 3, description: 'id wiadomosci konkursu skonczonego', required: true }
        ]
    },
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
    } catch (error) {
        console.error('Error registering commands:', error);
    }
})();

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    client.user.setActivity('DARK-CODE.PL', { type: ActivityType.Watching });
});

function createGiveawayEmbed(duration, prize, winners) {
    return new EmbedBuilder()
        .setTitle('`🎉` DARK-CODE.PL ▸ KONKURS')
        .setDescription(
            `**Nagroda:** ${prize}\n` +
            `**Czas:** ${duration}\n` +
            `**Zwyciężcy:** ${winners}\n\n` +
            'Kliknij w 🎉, aby wziąć udział!'
        )
        .setColor('#9509dc')
        .setTimestamp();
}

async function endGiveaway(messageId, channel) {
    if (!activeGiveaways.has(messageId)) return false;
    const giveaway = activeGiveaways.get(messageId);
    clearTimeout(giveaway.timeout);
    activeGiveaways.delete(messageId);
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) return false;
    const reactions = await message.reactions.cache.get('🎉').users.fetch();
    const participants = reactions.filter(user => !user.bot).map(user => user.id);
    let winners = [];
    for (let i = 0; i < giveaway.winners && participants.length > 0; i++) {
        const winnerIndex = Math.floor(Math.random() * participants.length);
        winners.push(`<@${participants[winnerIndex]}>`);
        participants.splice(winnerIndex, 1);
    }
    const winnerText = winners.length > 0 ? winners.join(', ') : 'No valid participants';
    const endEmbed = new EmbedBuilder()
        .setTitle('`🎉` DARK-CODE.PL ▸ KONKURS')
        .setDescription(
            `**Nagroda:** ${giveaway.prize}\n` +
            `**Zwyciężcy:** ${winnerText}`
        )
        .setColor('#9509dc')
        .setTimestamp();
    const endMessage = await channel.send({ embeds: [endEmbed] });
    endedGiveaways.set(messageId, {
        channelId: channel.id,
        prize: giveaway.prize,
        winners: giveaway.winners,
        endedAt: new Date(),
        endMessageId: endMessage.id
    });
    return true;
}

async function rerollGiveaway(messageId) {
    if (!endedGiveaways.has(messageId)) return null;
    const giveaway = endedGiveaways.get(messageId);
    const channel = await client.channels.fetch(giveaway.channelId);
    const originalMessage = await channel.messages.fetch(messageId).catch(() => null);
    if (!originalMessage) return null;
    const reactions = await originalMessage.reactions.cache.get('🎉').users.fetch();
    const participants = reactions.filter(user => !user.bot).map(user => user.id);
    let newWinners = [];
    for (let i = 0; i < giveaway.winners && participants.length > 0; i++) {
        const winnerIndex = Math.floor(Math.random() * participants.length);
        newWinners.push(`<@${participants[winnerIndex]}>`);
        participants.splice(winnerIndex, 1);
    }
    return {
        prize: giveaway.prize,
        winners: newWinners,
        channel,
        endMessageId: giveaway.endMessageId
    };
}

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(process.env.PREFIX)) return;
    if (!message.member.roles.cache.has('1404155296158584904')) return message.reply('Nie masz wymaganej roli, aby użyć tej komendy.');
    const args = message.content.slice(process.env.PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'konkurs') {
        const channel = message.mentions.channels.first();
        if (!channel) return message.reply('Please mention a valid channel.');
        const duration = args[1];
        if (!duration) return message.reply('Please specify a duration (e.g., 1d, 2h).');
        const prize = args.slice(2, args.length - 1).join(' ');
        if (!prize) return message.reply('Please specify a prize.');
        const winners = parseInt(args[args.length - 1]);
        if (isNaN(winners) || winners < 1) return message.reply('Please specify a valid number of winners.');
        const embed = createGiveawayEmbed(duration, prize, winners);
        const giveawayMessage = await channel.send({ embeds: [embed] });
        await giveawayMessage.react('🎉');
        const timeout = setTimeout(async () => {
            await endGiveaway(giveawayMessage.id, channel);
        }, ms(duration));
        activeGiveaways.set(giveawayMessage.id, {
            channelId: channel.id,
            prize,
            winners,
            timeout
        });
        await message.reply(`Giveaway started in ${channel}! ${client.user.username} will handle the rest!`);
    }

    if (command === 'zakoncz') {
        const messageId = args[0];
        if (!messageId) return message.reply('Please provide a giveaway message ID.');
        const success = await endGiveaway(messageId, message.channel);
        if (!success) return message.reply('Could not find an active giveaway with that ID.');
        await message.reply(`${client.user.username} ended the giveaway successfully!`);
    }

    if (command === 'reroll') {
        const messageId = args[0];
        if (!messageId) return message.reply('Please provide an ended giveaway message ID.');
        const result = await rerollGiveaway(messageId);
        if (!result) return message.reply('Could not find an ended giveaway with that ID.');
        const winnerText = result.winners.length > 0 ? result.winners.join(', ') : 'No valid participants';
        const rerollEmbed = new EmbedBuilder()
            .setTitle('`🎉` DARK-CODE.PL ▸ KONKURS')
            .setDescription(
                `**Nagroda:** ${result.prize}\n` +
                `**Nowi Zwyciężcy:** ${winnerText}`
            )
            .setColor('#9509dc')
            .setTimestamp();
        const endMessage = await result.channel.messages.fetch(result.endMessageId).catch(() => null);
        if (endMessage) {
            await endMessage.edit({ embeds: [rerollEmbed] });
        } else {
            await result.channel.send({ embeds: [rerollEmbed] });
        }
        await message.reply(`${client.user.username} rerolled the giveaway successfully!`);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    if (!interaction.member.roles.cache.has('1404155296158584904')) return interaction.reply({ content: 'Nie masz wymaganej roli, aby użyć tej komendy.', ephemeral: true });
    const { commandName, options } = interaction;

    if (commandName === 'konkurs') {
        const channel = options.getChannel('kanal');
        const duration = options.getString('czas');
        const prize = options.getString('nagroda');
        const winners = options.getInteger('zwyciezcy');
        const embed = createGiveawayEmbed(duration, prize, winners);
        const giveawayMessage = await channel.send({ embeds: [embed] });
        await giveawayMessage.react('🎉');
        const timeout = setTimeout(async () => {
            await endGiveaway(giveawayMessage.id, channel);
        }, ms(duration));
        activeGiveaways.set(giveawayMessage.id, {
            channelId: channel.id,
            prize,
            winners,
            timeout
        });
        await interaction.reply({ content: `Giveaway started in ${channel}! ${client.user.username} will handle the rest!`, ephemeral: true });
    }

    if (commandName === 'zakoncz') {
        const messageId = options.getString('message_id');
        const success = await endGiveaway(messageId, interaction.channel);
        if (!success) return interaction.reply({ content: 'Could not find an active giveaway with that ID.', ephemeral: true });
        await interaction.reply({ content: `${client.user.username} ended the giveaway successfully!`, ephemeral: true });
    }

    if (commandName === 'reroll') {
        const messageId = options.getString('message_id');
        const result = await rerollGiveaway(messageId);
        if (!result) return interaction.reply({ content: 'Could not find an ended giveaway with that ID.', ephemeral: true });
        const winnerText = result.winners.length > 0 ? result.winners.join(', ') : 'No valid participants';
        const rerollEmbed = new EmbedBuilder()
            .setTitle('`🎉` DARK-CODE.PL ▸ KONKURS')
            .setDescription(
                `**Nagroda:** ${result.prize}\n` +
                `**Nowi Zwyciężcy:** ${winnerText}`
            )
            .setColor('#9509dc')
            .setTimestamp();
        const endMessage = await result.channel.messages.fetch(result.endMessageId).catch(() => null);
        if (endMessage) {
            await endMessage.edit({ embeds: [rerollEmbed] });
        } else {
            await result.channel.send({ embeds: [rerollEmbed] });
        }
        await interaction.reply({ content: `${client.user.username} rerolled the giveaway successfully!`, ephemeral: true });
    }
});

app.get('/', (req, res) => {
    res.send(`${client.user?.username || 'Giveaway Bot'} is running!`);
});

client.login(process.env.TOKEN)
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`${client.user.username} is ready!`);
        });
    })
    .catch(err => {
        console.error('Failed to login:', err);
        process.exit(1);
    });
