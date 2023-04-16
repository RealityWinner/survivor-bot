/* eslint-disable no-fallthrough */
const print = console.log;
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField, AttachmentBuilder, ActivityType } = require('discord.js');
const config = require('./config.js')
const moment = require('moment')
const axios = require('axios').create({ timeout: 5 * 60 * 1000 })
const sharp = require('sharp');
const { isDeveloper } = require('./config.js');
const { I18n } = require('i18n');
const path = require('path');

function applyLang(target) {
  const locale = target.locale || 'en'
  new I18n({
    register: target,
    defaultLocale: 'en',
    fallbacks: {
      'en-*': 'en',
      'es-*': 'es',
      'pt-*': 'pt',
      'sv-*': 'sv',
      'zh-*': 'zh',
    },
    directory: path.join(__dirname, 'locales'),
    autoReload: false,
    updateFiles: false,
    syncFiles: false,
    logDebugFn: ()=>{},
    logWarnFn: ()=>{},
    logErrorFn: print,
  });
  target.setLocale(locale)
}
applyLang({}) //test for logging errors at start


const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.sqlite');
db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS codes (code TEXT NOT NULL UNIQUE, used BOOL DEFAULT FALSE)");
  db.run("CREATE TABLE IF NOT EXISTS nitro_codes (code TEXT NOT NULL UNIQUE, used BOOL DEFAULT FALSE)");
  db.run("CREATE TABLE IF NOT EXISTS generic_codes (code TEXT NOT NULL UNIQUE, expired BOOL DEFAULT FALSE)");
  db.run("CREATE TABLE IF NOT EXISTS players (discordid TEXT NOT NULL, playerid TEXT NOT NULL, code TEXT NOT NULL, date DATETIME DEFAULT CURRENT_TIMESTAMP)");

  const fs = require('fs');
  try {
    let allFileContents = fs.readFileSync('codes.txt', 'utf-8');
    allFileContents.split(/\r?\n/).forEach(line =>  {
      line = line.trim()
      if (line.length) {
        db.run("INSERT INTO codes(code) VALUES(?)", [line], () => {});
      }
    });
  } catch (error) {
    print(error)
  }


  try {
    let allFileContents = fs.readFileSync('nitro.txt', 'utf-8');
    allFileContents.split(/\r?\n/).forEach(line =>  {
      line = line.trim()
      if (line.length) {
        db.run("INSERT INTO nitro_codes(code) VALUES(?)", [line], () => {});
      }
    });
  } catch (error) {
    print(error)
  }
});




async function presentCaptcha(interaction, playerId) {
  let genRes = await axios.post('https://mail.survivorio.com/api/v1/captcha/generate').catch(() => {});
  if (!genRes || genRes.status != 200 || !genRes.data) {
    return await interaction.editReply({ content: interaction.__('Failed getting captcha. Try again later.') });
  }
  if (genRes.data.code != 0 || !genRes.data.data || !genRes.data.data.captchaId) {
    return await interaction.editReply({ content: interaction.__('Failed getting captcha. Try again later.') });
  }

  let captchaId = genRes.data.data.captchaId;
  let imageRes = await axios.get(`https://mail.survivorio.com/api/v1/captcha/image/${captchaId}`, { responseType: 'arraybuffer' }).catch(() => {});
  if (!imageRes || imageRes.status != 200 || !imageRes.data || !imageRes.data.length) {
    return await interaction.editReply({ content: interaction.__('Failed getting captcha. Try again later.') });
  }

  let data = await sharp(imageRes.data).flatten({ background: { r: 255, g: 255, b: 255 } }).toFormat('png').toBuffer()
  const captcha = new AttachmentBuilder(data, { name: 'captcha.png' });

  let enterButton = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`captcha-${playerId}-${captchaId}`)
        .setLabel(interaction.__('Solve captcha'))
        .setStyle(ButtonStyle.Primary),
    );
  return await interaction.editReply({ content: interaction.__('Please enter the captcha below'), files: [captcha], components: [enterButton] });
}



async function presentIdModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('idModal')
    .setTitle(interaction.__('Enter player id'));
  const playerIdInput = new TextInputBuilder()
    .setCustomId('playerId')
    .setLabel(interaction.__('What is your survivor.io player id'))
    .setMinLength(8)
    .setMaxLength(8)
    .setStyle(TextInputStyle.Short);
  
  let row = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM players WHERE discordId=? ORDER BY date DESC LIMIT 1', [interaction.user.id], (err, row) => {
      if (err) { reject(err) } else { resolve(row) }
    })
  })
  if (row && row.playerid) {
    playerIdInput.setValue(row.playerid)
  }
  
  modal.addComponents(new ActionRowBuilder().addComponents(playerIdInput));
  try {
    await interaction.showModal(modal);
  } catch (error) {
    print("Discord interaction error attempting to show playerId modal :(")
  }
}

async function presentCaptchaModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId(interaction.customId)
    .setTitle(interaction.__('Solve captcha'));
  const captchaInput = new TextInputBuilder()
    .setCustomId('captcha')
    .setLabel(interaction.__('What is the captcha solution'))
    .setMinLength(4)
    .setMaxLength(4)
    .setStyle(TextInputStyle.Short);
  modal.addComponents(new ActionRowBuilder().addComponents(captchaInput));
  try {
    await interaction.showModal(modal);
  } catch (error) {
    print("Discord interaction error attempting to show captcha modal :(")
  }
}


async function checkCanClaim(interaction, playerId) {
  let row = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM players WHERE discordId=? OR playerId=? ORDER BY date DESC LIMIT 1', [interaction.user.id, playerId], (err, row) => {
      if (err) { reject(err) } else { resolve(row) }
    })
  })

  if (row && row.date) {
    let prevClaim = moment(new Date(row.date)).utc();

    let claimDate = prevClaim.clone().utc().add(16, 'days');
    if (!interaction.member.premiumSinceTimestamp) {
      claimDate.add(16, 'days');
    }

    if (claimDate.month() > prevClaim.month()) {
      claimDate.second(0).minute(0).hour(0).date(1).month(prevClaim.month()+1)
    }
    if (claimDate > moment()
      // && !config.isDeveloper(interaction.user.id)
      ) {
      await interaction.editReply({ content: interaction.__('You cannot claim another code until %s', `<t:${claimDate.unix()}:f> <t:${claimDate.unix()}:R>`), ephemeral: true });
      return false
    }
  }

  return true
}







const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
	],
});

client.on("ready", async () => {
  console.log(`Bot has started`); 
  client.user.setActivity(`Survivor.io`, { type: ActivityType.Playing });


  let channel = client.channels.cache.get(config.logChannel);
  if (!channel) {
    print(`Log channel ${config.logChannel} not found!`)
    process.exit(1)
  }

  if (!channel.guild.members.me.permissionsIn(channel).has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages], true)) {
    print("Missing permissions to post in log channel")
    process.exit(1)
  }
});

client.on('interactionCreate', async interaction => {
  // interaction.locale = 'kr'
  applyLang(interaction)
  
  if (isDeveloper(interaction.user.id)) {
    interaction.member.premiumSinceTimestamp = 1
  }

	if (interaction.isChatInputCommand()) {
    if (!config.isDeveloper(interaction.user.id) && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return await interaction.reply({ content: `Sorry only admins :(`, ephemeral: true });
    }

    if (interaction.commandName === 'status') {
      let before = new Date()
      interaction.reply({ content: `Checking...`, ephemeral: true, fetchReply: true}).then (async (message) => {
        let after = new Date()
        db.get(`SELECT
        (SELECT count() FROM codes where used=0) as codes_left,
        (SELECT count() FROM codes) as codes_total,
        (SELECT count() FROM nitro_codes where used=0) as nitro_left,
        (SELECT count() FROM nitro_codes) as nitro_total
        `, [], (err, row) => {
          interaction.editReply(`Real time total ${new Date() - before}ms | API ${message.createdTimestamp - interaction.createdTimestamp}ms | WS ${Math.round(client.ws.ping)}ms | DB ${new Date() - after}ms
Normal codes remaining: ${Math.round(row.codes_left / row.codes_total * 100)}% (${row.codes_left} / ${row.codes_total})
Nitro codes remaining: ${Math.round(row.nitro_left / row.nitro_total * 100)}% (${row.nitro_left} / ${row.nitro_total})
`);
        })
      })
    }
    

    if (interaction.commandName === 'post') {
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');
      const label = interaction.options.getString('label');

      if (!interaction.guild.members.me.permissionsIn(channel).has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages], true)) {
        return await interaction.reply({ content: `ERROR missing permissions to post in that channel.`, ephemeral: true });
      }

      await channel.send({
        content: message,
        components: [new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('getCode')
              .setLabel(label)
              .setStyle(ButtonStyle.Primary),
          )
        ]
      })

      return await interaction.reply({ content: `Posted!`, ephemeral: true });
    }

    if (interaction.commandName === 'code') {
      await interaction.reply({ content: `Fetching a code. Hold on one moment.`, ephemeral: false });

      let row = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM codes WHERE used=FALSE ORDER BY RANDOM() LIMIT 1', [], (err, row) => {
          if (err) { reject(err) } else { resolve(row) }
        })
      })
      if (!row || !row.code) {
        return await interaction.editReply({ content: interaction.__('Sorry there are no more codes available!'), components: [], files: [] });
      }

      db.run("UPDATE codes SET used=TRUE WHERE code = ?", [row.code], () => {});
      return await interaction.editReply({ content: `Your code is \`${row.code}\`!`, components: [], files: [] });
    }


    if (interaction.commandName === 'lookup') {
      if (interaction.options.getSubcommand() === 'user') {
        let user = interaction.options.getMember('target');
        db.all('SELECT * FROM players WHERE discordId=? ORDER BY date DESC', [user.id], async (err, rows) => {
          let msg = rows.map((row) => {
            let claimDate = moment(new Date(row.date)).unix();
            return `Discord: ${row.discordid} PlayerId: ${row.playerid} Code: ${row.code} RedeemedAt: <t:${claimDate}:f> <t:${claimDate}:R>`
          }).join('\n')
          return await interaction.reply({ content: msg || "None", ephemeral: true });
        });
      }
      if (interaction.options.getSubcommand() === 'id') {
        let playerId = interaction.options.getString('target');
        if (!/^\d+$/.test(playerId)) {
          return await interaction.reply({ content: interaction.__('Invalid playerid \`%s\`. Please check again.', playerId), ephemeral: true });
        }
        db.all('SELECT * FROM players WHERE playerId=? ORDER BY date DESC', [playerId], async (err, rows) => {
          let msg = rows.map((row) => {
            let claimDate = moment(new Date(row.date)).unix();
            return `Discord: ${row.discordid} PlayerId: ${row.playerid} Code: ${row.code} RedeemedAt: <t:${claimDate}:f> <t:${claimDate}:R>`
          }).join('\n')
          return await interaction.reply({ content: msg || "None", ephemeral: true });
        });
      }
    }
  
  
  } else if (interaction.isButton()) {
    if (interaction.customId == 'getCode') {
      return await presentIdModal(interaction);
    }


    let parts = interaction.customId.split('-')
    if (parts[0] == 'captcha') {
      return await presentCaptchaModal(interaction)
    }




  } else if (interaction.isModalSubmit()) {
    if (interaction.customId == 'idModal') {
      try {
        await interaction.reply({ content: interaction.__('Checking...'), ephemeral: true });
      } catch (error) {
        return print("Discord interaction error :(")
      }

      const playerId = interaction.fields.getTextInputValue('playerId');
      if (!/^\d+$/.test(playerId)) {
        return await interaction.editReply({ content: interaction.__('Invalid playerid \`%s\`. Please check again.', playerId), ephemeral: true });
      }


      if (!await checkCanClaim(interaction, playerId)) { return }

      await interaction.editReply({ content: interaction.__('Fetching captcha...'), ephemeral: true });
      return await presentCaptcha(interaction, playerId);
    }

    let [customId, playerId, captchaId] = interaction.customId.split('-')
    if (customId == 'captcha') {
      try {
        await interaction.update({ content: interaction.__('Checking captcha...'), components: [], files: [] })
      } catch (error) {
        return print("Discord interaction error :(")
      }

      const captcha = interaction.fields.getTextInputValue('captcha');
      if (!/^\d+$/.test(captcha) || captcha.length != 4) {
        await interaction.editReply({ content: interaction.__('Invalid captcha, try again') });
        return await presentCaptcha(interaction, playerId)
      }


      if (!await checkCanClaim(interaction, playerId)) { return }

      let table = (interaction.member.premiumSinceTimestamp && moment.utc().date() > 16) ? "nitro_codes" : "codes"
      let row = await new Promise((resolve, reject) => {
        db.get(`SELECT * FROM ${table} WHERE used=FALSE ORDER BY RANDOM() LIMIT 1`, [], (err, row) => {
          if (err) { reject(err) } else { resolve(row) }
        })
      })
      if (!row || !row.code) {
        return await interaction.editReply({ content: interaction.__('Sorry there are no more codes available!') });
      }

      let resp = await axios.post('https://mail.survivorio.com/api/v1/giftcode/claim', {
        userId: playerId,
        giftCode: row.code,
        captchaId: captchaId,
        captcha: captcha,
      }).catch(() => {});
      if (!resp || !resp.data) {
        return await interaction.editReply({ content: interaction.__('A problem occured when trying to redeem your gift-code. Please try again later.') });
      }
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

      // resp.data.code = 0
      switch (resp.data.code) {
        case 0: //Success!
          break;
        case 20402: //Already claimed code
        {
          print(`User has already claimed '${row.code}' or very unlikely bad code`)
          let channel = client.channels.cache.get(config.logChannel);
          if (channel) {
            channel.send({
              content: `[FAIL] Discord: ${interaction.member} \`${interaction.user.id}\` PlayerId: \`${playerId}\` - already claimed this month?`// <@638290398665768961> <@213081486583136256>`
            })
          }
          return await interaction.editReply({ content: interaction.__('Something went wrong... Have you already received a reward this month?'), ephemeral: true });
          // return await presentCaptcha(interaction, playerId);
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
              content: `[FAIL] Invalid(used/expired?) code \`${row.code}\` ${resp.data.code}`,
            })
          }
          db.run(`UPDATE ${table} SET used=TRUE WHERE code = ?`, [row.code], () => {});
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
          return await interaction.editReply({ content: interaction.__('Invalid playerid \`%s\`. Please check again.'), ephemeral: true });
        }
        default:
          return print("Unknown unhandled error code!", resp.data)
      }


      db.run(`UPDATE ${table} SET used=TRUE WHERE code = ?`, [row.code], () => {});
      db.run(`INSERT INTO players(discordid, playerid, code, date) VALUES(?, ?, ?, ?)`, [interaction.user.id, playerId, row.code, moment().unix() * 1000], () => {});

      print(`Redeem success Discord: ${interaction.member.displayName} \`${interaction.user.id}\` PlayerId: \`${playerId}\` Code: \`${row.code}\``)
      let channel = client.channels.cache.get(config.logChannel);
      if (channel) {
        channel.send({
          content: `[REDEEM] Discord: ${interaction.member} \`${interaction.user.id}\` PlayerId: \`${playerId}\` Code: \`${row.code}\` Locale: \`${interaction.locale}\``,
        })
      }

      return await interaction.editReply({ content: interaction.__('Congratulations! Your rewards have been sent to your in-game Mailbox. Go and check it out!'), ephemeral: true });
    }
  }
});

process.on('uncaughtException', async function (err) {
  print(err)
  try {
    let reformed = await client.users.createDM('638290398665768961');
    if (reformed) {
      reformed.send(`\`\`\`${err.stack}\`\`\``)
    }
  } catch (error) {}
});

if (config.token) {
  client.login(config.token);
}
