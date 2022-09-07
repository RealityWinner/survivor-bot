const print = console.log;
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonInteraction, InteractionType, PermissionsBitField } = require('discord.js');
const config = require('./config.js')
const moment = require('moment')

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.sqlite');
db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS codes (code TEXT NOT NULL UNIQUE, used BOOL DEFAULT FALSE)");
  db.run("CREATE TABLE IF NOT EXISTS players (discordid TEXT NOT NULL, playerid TEXT NOT NULL, code TEXT NOT NULL, date DATETIME DEFAULT CURRENT_TIMESTAMP)");

  const fs = require('fs');
  const allFileContents = fs.readFileSync('codes.txt', 'utf-8');
  allFileContents.split(/\r?\n/).forEach(line =>  {
    line = line.trim()
    if (line.length) {
      db.run("INSERT INTO codes(code) VALUES(?)", [line], () => {});
    }
  });
});

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		// GatewayIntentBits.GuildMembers,
		// GatewayIntentBits.GuildMessages,
		// GatewayIntentBits.MessageContent,
	],
});


client.on("ready", () => {
  console.log(`Bot has started`); 
  client.user.setActivity(`survivio.io`, {type: 'PLAYING'});
});

client.on("guildCreate", guild => {
  console.log(`New guild joined: ${guild.name} (id: ${guild.id}). This guild has ${guild.memberCount} members!`);
});

client.on("guildDelete", guild => {
  console.log(`I have been removed from: ${guild.name} (id: ${guild.id})`);
});

client.on("messageCreate", async message => {
  if(message.author.bot) return;
});

client.on('interactionCreate', async interaction => {
	if (interaction.isChatInputCommand()) {
    print('slash command:', interaction.commandName);

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: `Sorry only admins :(`, ephemeral: true });
    }



    if (interaction.commandName === 'lookup') {
      if (interaction.options.getSubcommand() === 'user') {
        let user = interaction.options.getMember('target');
        db.all('SELECT * FROM players WHERE discordId=?', [user.id], (err, rows) => {
          let msg = rows.map((row) => {
            let claimDate = moment(row.date).unix();
            return `Discord: ${row.discordid} PlayerId: ${row.playerid} Code: ${row.code} RedeemedAt: <t:${claimDate}:f> <t:${claimDate}:R>`
          }).join('\n')
          return interaction.reply({ content: msg || "None", ephemeral: true });
        });
      }
      if (interaction.options.getSubcommand() === 'id') {
        let playerId = interaction.options.getString('target');
        if (!/^\d+$/.test(playerId) || playerId <= 10000000 || playerId >= 20000000) {
          return interaction.reply({ content: `Invalid playerid \`${playerId}\``, ephemeral: true });
        }
        db.all('SELECT * FROM players WHERE playerId=?', [playerId], (err, rows) => {
          let msg = rows.map((row) => {
            let claimDate = moment(row.date).unix();
            return `Discord: ${row.discordid} PlayerId: ${row.playerid} Code: ${row.code} RedeemedAt: <t:${claimDate}:f> <t:${claimDate}:R>`
          }).join('\n')
          return interaction.reply({ content: msg || "None", ephemeral: true });
        });
      }
    }

    if (interaction.commandName === 'post') {
      const channel = interaction.options.getChannel('destination');
      const text = interaction.options.getString('text');

      await channel.send({
        content: text,
        components: [new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('getCode')
              .setLabel('Get Code')
              .setStyle(ButtonStyle.Primary),
          )
        ]
      })

      return interaction.reply({ content: `Posted!`, ephemeral: true });
    }
  } else if (interaction instanceof ButtonInteraction) {
    let checkDate = moment().subtract(1, 'months');
    if (checkDate < interaction.user.createdAt) {
      return interaction.reply({ content: `Sorry. A problem occured, please contact a mod.`, ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId('codeModal')
      .setTitle('Get Code');
    const playerIdInput = new TextInputBuilder()
      .setCustomId('playerId')
      .setLabel("What is your survivor.io player id")
      .setStyle(TextInputStyle.Short);
    modal.addComponents(new ActionRowBuilder().addComponents(playerIdInput));
    try {
      await interaction.showModal(modal);
    } catch (error) {}
    return

  } else if (interaction.isModalSubmit()) {
    const playerId = interaction.fields.getTextInputValue('playerId');
    const discordId = interaction.user.id;

    //10000000
    //11111111
    //20000000
    if (!/^\d+$/.test(playerId) || playerId <= 10000000 || playerId >= 20000000) {
      return interaction.reply({ content: `Invalid playerid \`${playerId}\``, ephemeral: true });
    }


    let replied = false;
    db.serialize(() => {
      db.each('SELECT * FROM players WHERE discordId=? OR playerId=?', [discordId, playerId], (err, row) => {
        if (replied) { return; }

        let claimDate = moment(row.date).add(30, 'days');
        if (interaction.member.premiumSinceTimestamp) {
          claimDate = claimDate.subtract(15, 'days');
        }
        if (moment() < claimDate && !config.isDeveloper(interaction.user.id)) {
          print(`User '${interaction.user.id}' tried to claim another code early with player id '${playerId}'`);
          interaction.reply({ content: `You cannot claim another code until <t:${claimDate.unix()}:f> <t:${claimDate.unix()}:R>`, ephemeral: true });
          replied = true;
        }
      });

      db.get('SELECT * FROM codes WHERE used=FALSE ORDER BY RANDOM() LIMIT 1', [], (err, row) => {
        if (replied) { return; }

        if (err) {
          print(err);
          return interaction.reply({ content: 'Sorry a problem occured!', ephemeral: true });
        }

        if (!row) {
          return interaction.reply({ content: `Sorry there are no codes available at this time`, ephemeral: true });
        }

        print(`Got code ${row.code}`);
        db.run("UPDATE codes SET used=TRUE WHERE code = ? AND used=FALSE", [row.code], (err) => {
          if (err) {
            return print(err); //TODO Handle
          }
        });
        db.run(`INSERT INTO players(discordid, playerid, code, date) VALUES(?, ?, ?, ?)`, [discordId, playerId, row.code, moment()], function(err) {
          if (err) {
            return print(err); //TODO Handle
          }
          interaction.reply({ content: `Thanks! Your code is \`${row.code}\``, ephemeral: true });

          let channel = client.channels.cache.get(config.logChannel);
          if (channel) {
            channel.send({
              content: `[REDEEM] Discord: ${interaction.member} \`${discordId}\` PlayerId: \`${playerId}\` Code: \`${row.code}\``,
            })
          }
        });
      });
    });
  }


  // if (!interaction.replied) {
  //   interaction.reply({ content: 'This shouldn\'t happen :(', ephemeral: true });
  // }
});

if (config.token) {
  client.login(config.token);
}