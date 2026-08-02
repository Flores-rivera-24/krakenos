import type { GuideTranslations } from '../localize';

/**
 * Traducción al inglés de las guías de plugs (US-177). Superpone solo el texto
 * visible sobre la fuente en español (`integrations/plugs.ts`); la estructura la
 * toma el original.
 */
export const PLUGS_GUIDES_EN: GuideTranslations = {
  kasa: {
    displayName: 'TP-Link Kasa',
    vendor: 'TP-Link',
    intro:
      'TP-Link’s Kasa plugs, switches and bulbs (generation 1 and 2, like the HS103 or the HS200) can be controlled directly over your WiFi network, without the TP-Link app or cloud. And best of all: they usually find themselves, without you having to configure anything. You will be able to turn them on and off, and adjust brightness or color on the models that support it.',
    prerequisites: [
      'Kasa plugs or switches (generation 1/2) already set up and connected to your WiFi.',
      'The KrakenOS server on the same network as the Kasa devices (for automatic discovery).',
      'Recommended: reserve a fixed IP for them on the router.',
    ],
    steps: [
      {
        title: 'Let them discover themselves',
        body: 'Generation 1 and 2 Kasa devices answer a “call” that KrakenOS sends across the network, so in most cases they show up on their own without any configuration. If that is your case, save and leave the address field empty.',
      },
      {
        title: 'If they don’t show up, add their addresses',
        body: 'If you have the smart devices on a separate network and the call does not reach them, type their IP addresses by hand, separated by commas. You will find each Kasa’s IP on your router or in the Kasa app.',
        note: 'Tip: assign a fixed IP to each Kasa in the app or on the router, so they don’t change.',
      },
      {
        title: 'Save and test',
        body: 'Once saved, your Kasa devices appear with their name. Try turning them on and off: the plug or the light responds instantly.',
      },
    ],
    fields: {
      deviceIps: {
        label: 'Kasa addresses (optional)',
        help: 'Only if they are not discovered automatically: your Kasa devices’ IPs separated by commas, for example 192.168.1.60, 192.168.1.62. Leave it empty for automatic discovery.',
        placeholder: '192.168.1.60, 192.168.1.62',
      },
    },
    troubleshooting: [
      {
        q: 'They are not discovered automatically.',
        a: 'This usually happens when you have the smart devices on another network (VLAN). Add their IP addresses by hand in the field above.',
      },
      {
        q: 'I have a Kasa that does not respond.',
        a: 'Some recent Kasa models have switched to using the same system as Tapo. If a Kasa does not respond, try setting it up as a Tapo device (with your TP-Link credentials and its IP).',
      },
    ],
  },
  tapo: {
    displayName: 'TP-Link Tapo',
    vendor: 'TP-Link',
    intro:
      'TP-Link’s Tapo plugs and bulbs (generation 3 onward, like the P100, P110 or L530) are controlled locally, but they need your TP-Link account credentials to establish a secure connection with each device. Don’t worry: even though you use your email and password, the communication is local; that data only serves to create the security key, it does not go out to the internet.',
    prerequisites: [
      'Tapo plugs or bulbs (generation 3+) set up and connected to your WiFi.',
      'Your TP-Link account credentials (the same email and password as the Tapo app).',
      'Each Tapo’s IP (it is best to reserve it as fixed on the router).',
    ],
    steps: [
      {
        title: 'Reserve a fixed IP for each Tapo',
        body: 'Automatic discovery of Tapo devices is not reliable, so you have to provide their addresses. First, on your router, reserve a fixed IP for each Tapo so it does not change over time. Write down those addresses.',
      },
      {
        title: 'Have your TP-Link account ready',
        body: 'Tapo devices require your TP-Link account credentials (the same as the Tapo app) to negotiate a secure connection. They are used locally to derive the key; they are not sent to the internet. They are stored encrypted on your server.',
      },
      {
        title: 'Connect KrakenOS',
        body: 'Enter your TP-Link email and password and the IP addresses of your Tapo devices, separated by commas. Once saved, the devices appear with their name and respond instantly.',
      },
    ],
    fields: {
      email: {
        label: 'TP-Link account email',
        help: 'The email you use to sign in to the Tapo app.',
        placeholder: 'your-email@example.com',
      },
      password: {
        label: 'TP-Link password',
        help: 'Your TP-Link account password. It is used locally to create the security key and is stored encrypted.',
      },
      deviceIps: {
        label: 'Tapo addresses',
        help: 'Your Tapo devices’ IPs separated by commas, for example 192.168.1.61, 192.168.1.63. It is best if they are fixed.',
        placeholder: '192.168.1.61, 192.168.1.63',
      },
    },
    troubleshooting: [
      {
        q: 'It cannot find the Tapo devices.',
        a: 'Automatic discovery of Tapo is unreliable: make sure you type the IP addresses by hand and that they are correct (better if they are reserved as fixed).',
      },
      {
        q: 'Is it safe to enter my TP-Link password?',
        a: 'Yes. It is used only inside your network to create each device’s security key and is stored encrypted. It is not sent to the internet.',
      },
      {
        q: 'Can I see the P110’s power consumption?',
        a: 'For now the integration covers on/off, brightness and color. Power consumption is not shown yet.',
      },
    ],
  },
  shelly: {
    displayName: 'Shelly',
    vendor: 'Shelly (Allterco)',
    intro:
      'Shelly makes relays, plugs and dimmers highly valued for their 100% local control. KrakenOS talks to them directly over your network, without the cloud. Since there is no reliable automatic discovery, you will have to enter each device with its details. In exchange, on the models with metering you will be able to see even the consumption in watts.',
    prerequisites: [
      'Shelly devices set up and connected to your WiFi.',
      'Each Shelly’s IP (better if it is fixed). Recommended: disable the cloud in the Shelly app for 100% local control.',
      'Knowing each one’s generation (Gen1, or Gen2/Gen3) and whether it is a relay or a light.',
    ],
    steps: [
      {
        title: 'Disable the cloud and fix the IPs (recommended)',
        body: 'For fully local control, in the Shelly app or on each device’s web page disable the cloud connection. While you are at it, reserve a fixed IP for each Shelly on your router: you will need it to identify it.',
      },
      {
        title: 'Gather each device’s details',
        body: 'For each Shelly you need: its IP, a name, its generation (1 for the older ones like Shelly 1/2.5/Plug S; 2 for the Plus/Pro/Mini), the number of channels or outputs it has, and whether it is a relay (on/off) or a light (allows dimming). Keep in mind that each channel appears as a separate device.',
      },
      {
        title: 'Connect KrakenOS',
        body: 'Enter the list of your Shelly devices with those details. Once saved, each channel appears separately with its name, ready to turn on and off; on the models with metering you will also see the consumption.',
      },
    ],
    fields: {
      devices: {
        label: 'List of Shelly devices',
        help: 'One device per line with its IP, name, generation (1 or 2), number of channels and type (relay or light). The assistant helps you fill in each one; internally it is stored as a list.',
        placeholder: '192.168.1.80 · Boiler · Gen1 · 1 channel · relay',
      },
    },
    troubleshooting: [
      {
        q: 'Why do I have to enter them by hand?',
        a: 'Shelly devices do not offer reliable automatic discovery on the network, so you have to add them one by one with their IP and details.',
      },
      {
        q: 'A Shelly with two relays appears twice.',
        a: 'That is expected: each channel or output is shown as a separate device so you can control them independently.',
      },
      {
        q: 'I don’t see the consumption in watts.',
        a: 'Only the models with metering (1PM, 2.5, Plug S, Pro 4PM…) report watts. Those without it do not show consumption.',
      },
    ],
  },
  meross: {
    displayName: 'Meross',
    vendor: 'Meross',
    intro:
      'Meross plugs and switches (MSS110, MSS310, MSS425 power strips…) normally talk to the Meross cloud. To control them locally you need a somewhat advanced setup: a message “postman” (an MQTT broker) on your network and redirecting the Meross traffic toward it. It is the plug integration with the most steps, meant for those seeking total independence from the cloud.',
    prerequisites: [
      'An MQTT broker (for example Mosquitto) installed on your server, listening on port 1883.',
      'Being able to redirect the name “iot.meross.com” to your broker (with Pi-hole, dnsmasq or the router).',
      'The key and the identifier (uuid) of each Meross, obtained once from your Meross account.',
    ],
    steps: [
      {
        title: 'Install the MQTT broker',
        body: 'On your server, install an MQTT broker such as Mosquitto and configure it to listen on your network (port 1883). The broker is the “postman” through which the Meross messages will pass.',
      },
      {
        title: 'Redirect the Meross DNS to your broker',
        body: 'Meross devices try to connect to “iot.meross.com”. You have to trick them into talking to your local broker instead. In Pi-hole or on your router, create a rule that points “iot.meross.com” to your broker’s IP. Then power each Meross off and on so it reconnects to the local broker.',
        note: 'Example in Pi-hole/dnsmasq: address=/iot.meross.com/192.168.1.5',
      },
      {
        title: 'Get each Meross’s key',
        body: 'Each Meross signs its messages with a key tied to your Meross account. It is obtained once (with tools like meross-cli using your Meross username and password). Write down the “uuid” and the “key” of each device. The key is stored only on your server.',
      },
      {
        title: 'Connect KrakenOS',
        body: 'Enter your broker’s address and port, and the list of your Meross devices with their uuid, their key and their name. Once saved, the plugs appear and respond to on/off.',
      },
    ],
    fields: {
      brokerHost: {
        label: 'MQTT broker address',
        help: 'Your broker’s (Mosquitto) IP on the network, for example 192.168.1.5.',
        placeholder: '192.168.1.5',
      },
      brokerPort: {
        label: 'Broker port',
        help: 'The broker’s “door”. The usual one is 1883.',
      },
      devices: {
        label: 'List of Meross devices',
        help: 'One device per line with its uuid, its key and a name. The assistant helps you fill in each one; internally it is stored as a list. The key is stored encrypted.',
        placeholder: '2012… · TV plug · (key)',
      },
    },
    troubleshooting: [
      {
        q: 'The Meross devices still go to the cloud.',
        a: 'The DNS redirect is not taking effect. Check the rule that points “iot.meross.com” to your broker and restart (power off and on) each Meross so it reconnects.',
      },
      {
        q: 'I can’t get the key.',
        a: 'The key is obtained once from your Meross account with a command-line tool. Without it, the Meross devices cannot be controlled locally.',
      },
      {
        q: 'Can I see consumption or move blinds?',
        a: 'This version covers on/off. Consumption (MSS310) and blinds are not available yet.',
      },
    ],
  },
  mqtt: {
    displayName: 'MQTT Discovery (ESPHome, Tasmota…)',
    intro:
      'This is not a single brand’s integration: it is the open door. Many devices — the ones running ESPHome or Tasmota, cheap plugs freed with OpenBeken, your Z-Wave network or your zigbee2mqtt — know how to announce themselves over an open convention. Connect KrakenOS to an MQTT broker on your network and they all show up, without anyone having to write an adapter for your exact model.',
    prerequisites: [
      'An MQTT broker on your network (Mosquitto is the usual one): the “postman” your devices’ messages go through. The same one you already use for zigbee2mqtt works.',
      'Your devices set up to publish to it, with automatic announcement enabled.',
      'The "mqtt" package installed on the KrakenOS server (or having installed with the extra dependencies option).',
    ],
    steps: [
      {
        title: 'Have an MQTT broker at home',
        body: 'Devices do not talk to KrakenOS directly: they leave their messages on an MQTT broker on your network — the “postman” — and KrakenOS reads them from there. If you already have one for zigbee2mqtt or Meross, that same one works.',
      },
      {
        title: 'Tell each device to announce itself',
        body: 'In ESPHome, with the "mqtt" block in its configuration. In Tasmota, with a command in its console. In OpenBeken, with the button that sends the announcement. In zigbee2mqtt and Z-Wave JS UI, by enabling their automatic announcement option.',
        note: 'The example command is the Tasmota one. The steps for each firmware are in the full guide.',
      },
      {
        title: 'Connect KrakenOS to the broker',
        body: 'Type your MQTT broker’s address below and, if you protected it, its username and password. Test the connection and save.',
      },
      {
        title: 'Watch them show up',
        body: 'The devices appear under “IoT devices” within seconds, with their name and category. A plug with a meter shows up as a plug with its consumption reading, not as two separate things.',
        note: 'If none show up, it is almost always that the device is not publishing its announcement: check step 2.',
      },
    ],
    fields: {
      brokerUrl: {
        label: 'MQTT broker address',
        help: 'The address of your MQTT broker on the network, with its port. It is usually 1883.',
      },
      discoveryPrefix: {
        label: 'Announcement prefix',
        help: 'Leave it as it is unless you changed the prefix on your devices. It is named that way because it is the name chosen by whoever invented the convention; KrakenOS does not talk to Home Assistant for this.',
      },
      username: {
        label: 'Username (optional)',
        help: 'Only if your broker asks for a username and password.',
      },
      password: {
        label: 'Password (optional)',
        help: 'Only if your broker asks for a username and password. It is stored encrypted and never shown again.',
      },
    },
    troubleshooting: [
      {
        q: 'No devices show up.',
        a: 'Most likely they are not publishing their announcement. Check it from the server with: mosquitto_sub -h YOUR_SERVER -t \'homeassistant/#\' -v. If nothing comes out there, the problem is between the device and the broker.',
      },
      {
        q: 'The device shows up but not its state.',
        a: 'Some firmwares describe their values with a formula that KrakenOS deliberately does not interpret (it would mean running instructions that arrive over the network). The device is still listed, but that reading stays empty. It may also be that it has not published its state yet: restart it.',
      },
      {
        q: 'I have a lock and cannot open it from the app.',
        a: 'That is deliberate: locks are read but not opened from KrakenOS until their security policy is decided. A failure in that path opens your front door.',
      },
      {
        q: 'Will my devices be duplicated if I also use Home Assistant?',
        a: 'No. KrakenOS ignores what it publishes itself, so it does not ingest itself. And whatever Home Assistant publishes does not come in either: only the devices’ own announcements are read here.',
      },
    ],
  },
};
