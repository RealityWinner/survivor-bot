const { SlashCommandBuilder, Routes } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { clientId, token } = require('./config.js');

const commands = [
	new SlashCommandBuilder()
        .setName('lookup')
        .setDescription('Looks up a playerid')
        .addSubcommand(subcommand =>
            subcommand
                .setName('user')
                .setDescription('Info about a discord user')
                .addUserOption(option =>
                    option.setName('target')
                        .setDescription('user')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('id')
                .setDescription('Info about a player id')
                .addStringOption(option =>
                    option.setName('target')
                        .setDescription('id')
                        .setRequired(true)))
        .setDMPermission(false),
	new SlashCommandBuilder()
        .setName('post')
        .setDescription('Post the lookup button to a specific channel')
        .addChannelOption(option =>
            option.setName('destination')
                .setDescription('Channel to post to')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('text')
                .setDescription('The body of the message to send')
                .setRequired(true))
        .setDMPermission(false),
]
.map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

rest.put(Routes.applicationCommands(clientId), { body: commands })
	.then((data) => console.log(`Successfully registered ${data.length} application commands.`))
	.catch(console.error);
