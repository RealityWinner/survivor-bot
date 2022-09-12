/* eslint-disable no-fallthrough */
const print = console.log;
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonInteraction, PermissionsBitField, AttachmentBuilder, EmbedBuilder, SelectMenuBuilder } = require('discord.js');
const config = require('./config.js')
const moment = require('moment')
const axios = require('axios')
const sharp = require('sharp')

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.sqlite');
db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS codes (code TEXT NOT NULL UNIQUE, used BOOL DEFAULT FALSE)");
  db.run("CREATE TABLE IF NOT EXISTS players (discordid TEXT NOT NULL, playerid TEXT NOT NULL, code TEXT NOT NULL, date DATETIME DEFAULT CURRENT_TIMESTAMP)");

  try {
    const fs = require('fs');
    const allFileContents = fs.readFileSync('codes.txt', 'utf-8');
    allFileContents.split(/\r?\n/).forEach(line =>  {
      line = line.trim()
      if (line.length) {
        db.run("INSERT INTO codes(code) VALUES(?)", [line], () => {});
      }
    });
  } catch (error) {}
});



function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function presentCaptcha(interaction, playerId) {
  if (!interaction.deferred && !interaction.replied) {
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (error) {}
  }

  let genRes = await axios.post('https://mail.survivorio.com/api/v1/captcha/generate')
  if (!genRes || genRes.status != 200 || !genRes.data) {
    return await interaction.editReply('Failed getting captcha id');
  }
  if (genRes.data.code != 0 || !genRes.data.data || !genRes.data.data.captchaId) {
    return await interaction.editReply('Failed getting captcha id');
  }

  let captchaId = genRes.data.data.captchaId;
  let imageRes = await axios.get(`https://mail.survivorio.com/api/v1/captcha/image/${captchaId}`, { responseType: 'arraybuffer' })
  if (!imageRes || imageRes.status != 200 || !imageRes.data || !imageRes.data.length) {
    if (interaction.replied) {
      return await interaction.followUp({ content: 'Failed getting captcha image. Try again later.', ephemeral: true });
    } else {
      return await interaction.editReply('Failed getting captcha image. Try again later.');
    }
  }

  let data = await sharp(imageRes.data).flatten({ background: { r: 255, g: 255, b: 255 } }).toFormat('png').toBuffer()
  const captcha = new AttachmentBuilder(data, { name: 'captcha.png' });

  let enterButton = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`captcha-${playerId}-${captchaId}`)
        .setLabel('Enter captcha code')
        .setStyle(ButtonStyle.Primary),
    );
  if (interaction.replied) {
    return await interaction.followUp({ content: 'Invalid captcha, try again', files: [captcha], components: [enterButton], ephemeral: true });
  } else {
    return await interaction.editReply({ content: 'Please enter the captcha below', files: [captcha], components: [enterButton] });
  }
}



async function presentIdModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('idModal')
    .setTitle('Enter player id');
  const playerIdInput = new TextInputBuilder()
    .setCustomId('playerId')
    .setLabel("What is your survivor.io player id")
    .setMinLength(8)
    .setStyle(TextInputStyle.Short);
  modal.addComponents(new ActionRowBuilder().addComponents(playerIdInput));
  try {
    await interaction.showModal(modal);
  } catch (error) {
    print(error)
  }
}

async function presentCaptchaModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId(interaction.customId)
    .setTitle('Solve captcha');
  const captchaInput = new TextInputBuilder()
    .setCustomId('captcha')
    .setLabel("What is the captcha solution")
    .setMinLength(4)
    .setMaxLength(4)
    .setStyle(TextInputStyle.Short);
  modal.addComponents(new ActionRowBuilder().addComponents(captchaInput));
  try {
    await interaction.showModal(modal);
  } catch (error) {
    print(error)
  }
}









const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
	],
});

client.on("ready", () => {
  console.log(`Bot has started`); 
  client.user.setActivity(`survivio.io`, {type: 'PLAYING'});
});

client.on('interactionCreate', async interaction => {
	if (interaction.isChatInputCommand()) {
    if (!config.isDeveloper(interaction.user.id) && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: `Sorry only admins :(`, ephemeral: true });
    }


    if (interaction.commandName === 'captcha') {
      return presentCaptcha(interaction, 11111111)
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
              .setLabel('Get gift-code')
              .setStyle(ButtonStyle.Primary),
          )
        ]
      })

      return interaction.reply({ content: `Posted!`, ephemeral: true });
    }


    if (interaction.commandName === 'lookup') {
      if (interaction.options.getSubcommand() === 'user') {
        let user = interaction.options.getMember('target');
        db.all('SELECT * FROM players WHERE discordId=?', [user.id], (err, rows) => {
          let msg = ""
          msg += rows.map((row) => {
            let claimDate = moment(new Date(row.date)).unix();
            return `Discord: ${row.discordid} PlayerId: ${row.playerid} Code: ${row.code} RedeemedAt: <t:${claimDate}:f> <t:${claimDate}:R>`
          }).join('\n')
          return interaction.reply({ content: msg, ephemeral: true });
        });
      }
      if (interaction.options.getSubcommand() === 'id') {
        let playerId = interaction.options.getString('target');
        if (!/^\d+$/.test(playerId)) {
          return interaction.reply({ content: `Invalid playerid \`${playerId}\``, ephemeral: true });
        }
        db.all('SELECT * FROM players WHERE playerId=?', [playerId], (err, rows) => {
          let msg = rows.map((row) => {
            let claimDate = moment(new Date(row.date)).unix();
            return `Discord: ${row.discordid} PlayerId: ${row.playerid} Code: ${row.code} RedeemedAt: <t:${claimDate}:f> <t:${claimDate}:R>`
          }).join('\n')
          return interaction.reply({ content: msg || "None", ephemeral: true });
        });
      }
    }
  
  
  } else if (interaction.isButton()) {
    if (interaction.customId == 'getCode') {
      let checkDate = moment(interaction.user.createdAt).add(1, 'months');
      if (moment() < checkDate) {
        return interaction.reply({ content: `Sorry. Your discord account is not eligieble to claim a gift-code until <t:${checkDate.unix()}:f> <t:${checkDate.unix()}:R>`, ephemeral: true });
      }

      let row = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM players WHERE discordId=? ORDER BY date DESC LIMIT 1', [interaction.user.id], (err, row) => {
          if (err) { reject(err) } else { resolve(row) }
        })
      })

      if (row && row.date) {
        let claimDate = moment(new Date(row.date)).add(30, 'days');
        // if (interaction.member.premiumSinceTimestamp) {
        //   claimDate = claimDate.subtract(15, 'days');
        // }
        if (moment() < claimDate && !config.isDeveloper(interaction.user.id)) {
          return await interaction.reply({ content: `You cannot claim another code until <t:${claimDate.unix()}:f> <t:${claimDate.unix()}:R>`, ephemeral: true });
        }
      }

      // if (row && row.playerid) {
      //   return await presentCaptcha(interaction, row.playerid);
      // } else {
        return await presentIdModal(interaction);
      // }
    }


    let parts = interaction.customId.split('-')
    if (parts[0] == 'captcha') {
      return await presentCaptchaModal(interaction)
    }




  } else if (interaction.isModalSubmit()) {
    if (interaction.customId == 'idModal') {
      const playerId = interaction.fields.getTextInputValue('playerId');
      if (!/^\d+$/.test(playerId) || playerId <= 10000000) {
        return interaction.reply({ content: `Invalid playerid \`${playerId}\`. Please check again.`, ephemeral: true });
      }

      return await presentCaptcha(interaction, playerId);
    }

    let [customId, playerId, captchaId] = interaction.customId.split('-')
    if (customId == 'captcha') {
      const captcha = interaction.fields.getTextInputValue('captcha');
      if (!/^\d+$/.test(captcha) || captcha.length != 4) {
        await interaction.update({ content: `Invalid captcha, try again`, components: [], files: [] });
        await presentCaptcha(interaction, playerId)
        return
      }

      let row = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM codes WHERE used=FALSE ORDER BY RANDOM() LIMIT 1', [], (err, row) => {
          if (err) { reject(err) } else { resolve(row) }
        })
      })
      if (!row || !row.code) {
        return await interaction.update({ content: `Sorry there are no more codes available!`, components: [], files: [] });
      }


      interaction.update({ content: `Checking captcha...`, components: [], files: [] })
      let resp = await axios.post('https://mail.survivorio.com/api/v1/giftcode/claim', {
        userId: playerId,
        giftCode: row.code,
        captchaId: captchaId,
        captcha: captcha,
      })
      print(resp.status, resp.data)


// 0 === e ? this.newArr[0][20] //Congratulations! Your rewards have been sent to your in-game Mailbox. Go and check it out!
// 20001 === e ? this.newArr[0][37] //Redeem failed; information incorrect
// 20002 === e ? this.newArr[0][38] //Redeem failed; incorrect Verification Code
// 20003 === e ? this.newArr[0][21] //Oh no, we suspect your ID is incorrect. Please check again.
// 20401 === e ? this.newArr[0][22] //Oh no, we suspect your Rewards Code is incorrect. Please check again.
// 20402 === e ? this.newArr[0][23] //Oh no, your Rewards Code has already been used
// 20403 === e ? this.newArr[0][24] //Oh no, your Rewards Code has expired...
// 20404 === e ? this.newArr[0][44] 
// 20409 === e ? this.newArr[0][46]
// 30001 === e ? this.newArr[0][39] //Server is busy, please try again.

      switch (resp.data.code) {
        case 0: //Success!
          break;
        case 20402: //Already claimed code
        {
          print(`Found potentially invalid code '${row.code}' or user has already claimed from batch`)
          let channel = client.channels.cache.get(config.logChannel);
          if (channel) {
            channel.send({
              content: `[FAIL] Potential bad code \`${row.code}\` or already claimed from batch - Discord: ${interaction.member} \`${interaction.user.id}\` PlayerId: \`${playerId}\``// <@638290398665768961> <@213081486583136256>`
            })
          }
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: `Something went wrong... Have you already received a reward this month?`, ephemeral: true });
          } else {
            await interaction.reply({ content: `Something went wrong... Have you already received a reward this month?`, ephemeral: true });
          }
          return await presentCaptcha(interaction, playerId);
        }
        case 20401: //Bad code
        case 20403: //Expired code
        case 20404: //Redeem code is expired
        case 20409: //This redemption code has already been redeemed and can no longer be redeemed
        {
          print(`Found invalid code '${row.code}'. Marking as used.`)
          let channel = client.channels.cache.get(config.logChannel);
          if (channel) {
            channel.send({
              content: `[FAIL] Invalid code \`${row.code}\` ${resp.data.code}`,// <@638290398665768961> <@213081486583136256>`,
            })
          }
          db.run("UPDATE codes SET used=TRUE WHERE code = ?", [row.code], () => {});
        }
        case 30001: //Server is busy
        case 20002: //Invalid captcha
          return await presentCaptcha(interaction, playerId);
        case 20003: //Invalid playerId
        {
          let channel = client.channels.cache.get(config.logChannel);
          if (channel) {
            channel.send({
              content: `[FAIL] Bad player id entered - Discord: ${interaction.member} \`${interaction.user.id}\` PlayerId: \`${playerId}\``,
            })
          }
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: `Invalid playerid entered, try again`, ephemeral: true });
          } else {
            await interaction.reply({ content: `Invalid playerid entered, try again`, ephemeral: true });
          }
        }
        default:
          return print("Unknown unhandled error code!", resp.data)
      }


      db.run("UPDATE codes SET used=TRUE WHERE code = ?", [row.code], () => {});
      db.run(`INSERT INTO players(discordid, playerid, code, date) VALUES(?, ?, ?, ?)`, [interaction.user.id, playerId, row.code, moment()], () => {});

      let channel = client.channels.cache.get(config.logChannel);
      if (channel) {
        channel.send({
          content: `[REDEEM] Discord: ${interaction.member} \`${interaction.user.id}\` PlayerId: \`${playerId}\` Code: \`${row.code}\``,
        })
      }

      interaction.followUp({ content: `Congratulations! Your rewards have been sent to your in-game Mailbox. Go and check it out!`, ephemeral: true });
      return 
    }
  }
});

if (config.token) {
  client.login(config.token);
}