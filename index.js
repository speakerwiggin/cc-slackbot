/**
 * Created by speakerwiggin on 12/28/17.
 */

const SlackBot = require('slackbots')
const secrets = require('./secrets')
const request = require('request-promise')
const spark = require('textspark')
const io = require('socket.io-client')
const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

// create a bot
const bot = new SlackBot({
  token: secrets.token, // Add a bot https://my.slack.com/services/new/bot and put the token
  name: secrets.name
})

/* used for production */
const defaultChannel = secrets.channel
const defaultChannelName = secrets.channelName

// more information about additional params https://api.slack.com/methods/chat.postMessage
const defaultParams = {
  icon_emoji: ':coincap:'
}

const commands = `*All commands can be started with either \`coincap\` or \`cc\`*
Here are the commands:   
    coincap help
    coincap [coin]
    coincap show [coin, ex: btc, :btc:, bitcoin]
    coincap show [coin1] in [coin2]
    
Flags:
    cc -v [coin]    verbose output
    cc -r [rank]    get coin at specified rank
`

/**
 * Message that bot is connected
 */
bot.on('start', () => {
  // define channel, where bot exists.
  // can be adjusted here: https://my.slack.com/services

  bot.postMessageToChannel(defaultChannelName, 'Hello world!', defaultParams)
})

bot.on('message', (data) => {
  //console.log(data)

  trackDisconnect()

  if (!data || data.type !== 'message' || data.channel !== defaultChannel || !data.user || !data.text) return

  const regex = /:(\w+):/g
  data.text = data.text.replace(regex, '$1')

  const args = data.text.toLowerCase().split(/\s+/)
  const arg1 = (args.shift() || '').toLowerCase()
  const command = (args.shift() || '').toLowerCase()

  if (arg1 !== 'coincap' && arg1 !== 'cc') return
  console.log(args)

  if (/bee+s+h+/i.test(command)) return showCoin('bch')

  if (/^-/.test(command)) {
    const flags = command.split('').slice(1)

    const coin1 = flags.includes('r')
      ? coinData[coinData.ranks[parseInt(args.shift())]]
      : coinData[args.shift()]
    if (coin1 === undefined) return
    console.log(flags)

    if (flags.includes('v')) return postVerboseMessage(coin1)
    else return postMessage(coin1, coinData['btc'])
  }

  switch (command) {
    case 'help':
      sendHelp()
      break
    case 'show':
      showCoin(...args)
      break
    default:
      showCoin(command)
  }
})

/**
 * If we are receiving notifications, we must be connected.
 * If we don't receive anything for a while... make a request from our
 * end to see if we can still talk to slack.
 */
let disconnectTimer
function trackDisconnect () {
  clearTimeout(disconnectTimer)
  disconnectTimer = setTimeout(async () => {
    console.log('60 seconds without any messages, check api...')
    try {
      await bot.getUser('coinbot')
    } catch (e) {
      console.error('API FAIL, try restart', e)
      process.exit(1)
    }
  }, 60000)
}

function sendHelp () {
  bot.postMessageToChannel(defaultChannelName, commands, defaultParams)
}

function showCoin (...args) {
  const coin1 = coinData[args.shift()]
  if (coin1 === undefined) return

  switch (args[0]) {
    case 'in':
      const coin2 = coinData[args[1]]
      if (coin2 === undefined) return
      postMessage(coin1, coin2)
      break
    default:
      postMessage(coin1, coinData['btc'])
  }
}

function coincap (str) {
  return `http://coincap.io/${str}`
}

function postMessage (coin1, coin2, channel = defaultChannelName, params = defaultParams) {
  bot.postMessageToChannel(channel,
    `\
*${coin1.short.toUpperCase()}* \
:${/xrp/i.test(coin1.short) ? 'hankey' : coin1.short}: \
*${formatter.format(coin1.price)}* \
:${coin2.short}: \
*${coin1.short === coin2.short ? (1).toFixed(8) : (coin1.price / coin2.price).toFixed(8)}* \
${coin1.cap24hrChange >= 0 ? ':chart_with_upwards_trend:' : ':chart_with_downwards_trend:'} \
*${coin1.cap24hrChange}%*\
`, params)
}

function postVerboseMessage (coin, channel = defaultChannelName, params = defaultParams) {
  const loss = /-/.test(coin.cap24hrChange)
  params = Object.assign({}, params, {
    attachments: [
      {
        "color": loss ? '#ff0000' : '#00ff00',
        pretext: `:${/xrp/i.test(coin.short) ? 'hankey' : coin.short}: <http://coincap.io/${coin.short.toUpperCase()} | ${capitalize(coin.long)}> (${coin.short.toUpperCase()}) [Rank #${coin.rank} @ coincap.io]`,
        fields: [
          {
            title: 'Price',
            value: formatter.format(coin.price),
            short: true
          },
          {
            title: 'Volume',
            value: formatter.format(coin.volume),
            short: true
          },
          {
            title: '24hr Change',
            value: `${loss ? coin.cap24hrChange : '+' + coin.cap24hrChange}%`,
            short: true
          },
          {
            title: 'VWAP',
            value: formatter.format(coin.vwapData),
            short: true
          },
          {
            title: 'Market Cap',
            value: formatter.format(coin.mktcap),
            short: true
          },
          {
            title: 'Total Supply',
            value: coin.supply,
            short: true
          }
        ]
      }
    ]
  })
  bot.postMessageToChannel(channel, '', params)
}

function capitalize (str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}

const coinData = {}
coinData.ranks = []
async function getFront () {
  return request(coincap('front'), { json: true })
    .then((coins) => {
      coins.forEach((coin, rank) => {
        updateCoinData(Object.assign(coin, { rank: rank + 1 }))
        coinData.ranks[rank + 1] = coin.short.toLowerCase()
      })
    })
    .catch(err => { throw new Error(err) })
}

function updateCoinData (coin) {
  if (coinData[coin.short.toLowerCase()] === undefined) {
    coinData[coin.short.toLowerCase()] = {}
  }
  if (coinData[coin.long.toLowerCase()] === undefined) {
    coinData[coin.long.toLowerCase()] = {}
  }
  coinData[coin.short.toLowerCase()] = Object.assign(coinData[coin.short.toLowerCase()], coin)
  coinData[coin.long.toLowerCase()] = Object.assign(coinData[coin.long.toLowerCase()], coin)
}

getFront()
  .then(() => {
    console.log('starting socket')
    const socket = io.connect('https://coincap.io')

    socket.on('connect', () => {
      console.log('socket connected')
    })

    socket.on('trades', (trade) => {
      try {
        const { msg: coin } = trade
        updateCoinData(coin)
      }
      catch (e) { console.error(new Error(e)) }
    })
  })