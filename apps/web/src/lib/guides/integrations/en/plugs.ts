import type { IntegrationGuide } from '../../types';

/**
 * Smart plug and switch guides (domain 'iot', category 'plugs'):
 * Kasa, Tapo, Shelly, Meross and SwitchBot. Internalized from their docs and
 * rewritten in plain English for the wizard.
 */

const kasa: IntegrationGuide = {
  id: 'kasa',
  domain: 'iot',
  kind: 'kasa',
  category: 'plugs',
  displayName: 'TP-Link Kasa',
  vendor: 'TP-Link',
  icon: 'Plug',
  tier: 1,
  intro:
    'TP-Link Kasa plugs, switches and lights (the generation 1 and 2 ones, like the HS103 or the HS200) can be controlled directly over your WiFi network, without the TP-Link app or cloud. And best of all: they are usually found on their own, without you having to configure anything. You will be able to turn them on and off, and adjust the brightness or color on the models that allow it.',
  prerequisites: [
    'Kasa plugs or switches (generation 1/2) already set up and connected to your WiFi.',
    'The KrakenOS server on the same network as the Kasa devices (for automatic discovery).',
    'Recommended: reserve a fixed IP for them in the router.',
  ],
  steps: [
    {
      title: 'Let them discover themselves',
      body: 'Generation 1 and 2 Kasa devices respond to a "call" that KrakenOS sends across the network, so in most cases they appear on their own without configuring anything. If that is your case, save leaving the address field empty.',
    },
    {
      title: 'If they do not appear, add their addresses',
      body: 'If you keep your smart devices on a separate network and the call does not reach them, enter their IP addresses by hand, separated by commas. You will see the IP of each Kasa in your router or in the Kasa app.',
      note: 'Tip: assign a fixed IP to each Kasa in the app or in the router, so they do not change.',
      external: true,
    },
    {
      title: 'Save and test',
      body: 'When you save, your Kasa devices appear with their name. Try turning them on and off: the plug or the light responds instantly.',
    },
  ],
  fields: [
    {
      key: 'deviceIps',
      label: 'Kasa addresses (optional)',
      help: 'Only if they are not discovered on their own: the IPs of your Kasa devices separated by commas, for example 192.168.1.60, 192.168.1.62. Leave it empty for automatic discovery.',
      type: 'text',
      placeholder: '192.168.1.60, 192.168.1.62',
      required: false,
    },
  ],
  troubleshooting: [
    {
      q: 'They are not discovered automatically.',
      a: 'This usually happens if you keep your smart devices on another network (VLAN). Add their IP addresses by hand in the field above.',
    },
    {
      q: 'I have a Kasa that does not respond.',
      a: 'Some recent Kasa models have moved to the same system as Tapo. If a Kasa does not respond, try setting it up as Tapo (with your TP-Link credentials and its IP).',
    },
  ],
};

const tapo: IntegrationGuide = {
  id: 'tapo',
  domain: 'iot',
  kind: 'tapo',
  category: 'plugs',
  displayName: 'TP-Link Tapo',
  vendor: 'TP-Link',
  icon: 'Plug',
  tier: 2,
  intro:
    'TP-Link Tapo plugs and lights (generation 3 onward, like the P100, P110 or L530) are controlled locally, but they need your TP-Link account credentials to establish a secure connection with each device. Do not worry: even though you use your email and password, the communication is local; that data only serves to create the security key, it does not go out to the internet.',
  prerequisites: [
    'Tapo plugs or lights (generation 3+) set up and connected to your WiFi.',
    'Your TP-Link account credentials (the same email and password as the Tapo app).',
    'The IP of each Tapo (it is a good idea to reserve it as fixed in the router).',
  ],
  steps: [
    {
      title: 'Reserve a fixed IP for each Tapo',
      body: 'Automatic discovery of Tapo devices is not reliable, so you have to specify their addresses. First, in your router, reserve a fixed IP for each Tapo so it does not change over time. Note down those addresses.',
      external: true,
    },
    {
      title: 'Have your TP-Link account ready',
      body: 'Tapo devices require your TP-Link account credentials (the same as the Tapo app) to negotiate a secure connection. They are used locally to derive the key; they are not sent to the internet. They are stored encrypted on your server.',
      external: true,
    },
    {
      title: 'Connect KrakenOS',
      body: 'Enter your TP-Link email and password and the IP addresses of your Tapo devices, separated by commas. When you save, the devices appear with their name and respond instantly.',
    },
  ],
  fields: [
    {
      key: 'email',
      label: 'TP-Link account email',
      help: 'The email you use to sign in to the Tapo app.',
      type: 'text',
      placeholder: 'your-email@example.com',
      required: true,
    },
    {
      key: 'password',
      label: 'TP-Link password',
      help: 'The password for your TP-Link account. It is used locally to create the security key and is stored encrypted.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'deviceIps',
      label: 'Tapo addresses',
      help: 'The IPs of your Tapo devices separated by commas, for example 192.168.1.61, 192.168.1.63. It is best if they are fixed.',
      type: 'text',
      placeholder: '192.168.1.61, 192.168.1.63',
      required: true,
    },
  ],
  troubleshooting: [
    {
      q: 'It does not find the Tapo devices.',
      a: 'Automatic discovery of Tapo is unreliable: make sure you enter the IP addresses by hand and that they are correct (better if they are reserved as fixed).',
    },
    {
      q: 'Is it safe to enter my TP-Link password?',
      a: 'Yes. It is used only within your network to create the security key of each device and is stored encrypted. It is not sent to the internet.',
    },
    {
      q: 'Do I see the power consumption of the P110?',
      a: 'For now the integration covers on/off, brightness and color. Power consumption is not shown yet.',
    },
  ],
};

const shelly: IntegrationGuide = {
  id: 'shelly',
  domain: 'iot',
  kind: 'shelly',
  category: 'plugs',
  displayName: 'Shelly',
  vendor: 'Shelly (Allterco)',
  icon: 'Plug',
  tier: 3,
  intro:
    'Shelly makes relays, plugs and dimmers much appreciated for their 100% local control. KrakenOS talks to them directly over your network, without the cloud. Since there is no reliable automatic discovery, you will have to enter each device with its details. In return, on the models with metering you will even be able to see power consumption in watts.',
  prerequisites: [
    'Shelly devices set up and connected to your WiFi.',
    'The IP of each Shelly (better if it is fixed). Recommended: disable the cloud in the Shelly app for 100% local control.',
    'Knowing the generation of each one (Gen1, or Gen2/Gen3) and whether it is a relay or a light.',
  ],
  steps: [
    {
      title: 'Disable the cloud and fix the IPs (recommended)',
      body: 'For fully local control, in the Shelly app or on each device\'s web page disable the cloud connection. While you are at it, reserve a fixed IP for each Shelly in your router: you will need it to identify it.',
      external: true,
    },
    {
      title: 'Gather the details of each device',
      body: 'For each Shelly you need: its IP, a name, its generation (1 for the old ones like Shelly 1/2.5/Plug S; 2 for the Plus/Pro/Mini), the number of channels or outputs it has, and whether it is a relay (on/off) or a light (allows dimming). Keep in mind that each channel appears as a separate device.',
      external: true,
    },
    {
      title: 'Connect KrakenOS',
      body: 'Enter the list of your Shelly devices with those details. When you save, each channel appears separately with its name, ready to turn on and off; on the models with metering you will also see the consumption.',
    },
  ],
  fields: [
    {
      key: 'devices',
      label: 'List of Shelly devices',
      help: 'One device per line with its IP, name, generation (1 or 2), number of channels and type (relay or light). The wizard helps you fill in each one; internally it is stored as a list.',
      type: 'text',
      placeholder: '192.168.1.80 · Boiler · Gen1 · 1 channel · relay',
      required: true,
    },
  ],
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
      q: 'I do not see the consumption in watts.',
      a: 'Only the models with metering (1PM, 2.5, Plug S, Pro 4PM...) report watts. Those without it do not show consumption.',
    },
  ],
};

const meross: IntegrationGuide = {
  id: 'meross',
  domain: 'iot',
  kind: 'meross',
  category: 'plugs',
  displayName: 'Meross',
  vendor: 'Meross',
  icon: 'Plug',
  tier: 4,
  intro:
    'Meross plugs and switches (MSS110, MSS310, MSS425 power strips...) normally talk to the Meross cloud. To control them locally you need a somewhat advanced setup: a message "mailman" (MQTT broker) on your network and redirecting the Meross traffic toward it. It is the plug integration with the most steps, meant for anyone seeking total independence from the cloud.',
  prerequisites: [
    'An MQTT broker (for example Mosquitto) installed on your server, listening on port 1883.',
    'Being able to redirect the name "iot.meross.com" to your broker (with Pi-hole, dnsmasq or the router).',
    'The key and the identifier (uuid) of each Meross, obtained once from your Meross account.',
  ],
  steps: [
    {
      title: 'Install the MQTT broker',
      body: 'On your server, install an MQTT broker like Mosquitto and configure it to listen on your network (port 1883). The broker is the "mailman" through which the Meross messages will pass.',
      external: true,
    },
    {
      title: 'Redirect the Meross DNS to your broker',
      body: 'Meross devices try to connect to "iot.meross.com". You have to trick them into talking to your local broker instead. In Pi-hole or in your router, create a rule that points "iot.meross.com" to the IP of your broker. Then power each Meross off and on so it reconnects to the local broker.',
      note: 'Example in Pi-hole/dnsmasq: address=/iot.meross.com/192.168.1.5',
      external: true,
    },
    {
      title: 'Obtain the key of each Meross',
      body: 'Each Meross signs its messages with a key tied to your Meross account. It is obtained once (with tools like meross-cli using your Meross username and password). Note down the "uuid" and the "key" of each device. The key is stored only on your server.',
      external: true,
    },
    {
      title: 'Connect KrakenOS',
      body: 'Enter the address and port of your broker, and the list of your Meross devices with their uuid, their key and their name. When you save, the plugs appear and respond to on/off.',
    },
  ],
  fields: [
    {
      key: 'brokerHost',
      label: 'MQTT broker address',
      help: 'The IP of your broker (Mosquitto) on the network, for example 192.168.1.5.',
      type: 'host',
      placeholder: '192.168.1.5',
      required: true,
    },
    {
      key: 'brokerPort',
      label: 'Broker port',
      help: 'The "door" of the MQTT broker. The usual one is 1883.',
      type: 'number',
      required: false,
      defaultValue: 1883,
    },
    {
      key: 'devices',
      label: 'List of Meross devices',
      help: 'One device per line with its uuid, its key and a name. The wizard helps you fill in each one; internally it is stored as a list. The key is stored encrypted.',
      type: 'text',
      placeholder: '2012... · TV plug · (key)',
      required: true,
    },
  ],
  troubleshooting: [
    {
      q: 'The Meross devices keep going to the cloud.',
      a: 'The DNS redirection is not taking effect. Check the rule that points "iot.meross.com" to your broker and restart (power off and on) each Meross so it reconnects.',
    },
    {
      q: 'I cannot get the key.',
      a: 'The key is obtained once from your Meross account with a command-line tool. Without it, the Meross devices cannot be controlled locally.',
    },
    {
      q: 'Can I see the consumption or move blinds?',
      a: 'This version covers on/off. Consumption (MSS310) and blinds are not available yet.',
    },
  ],
};

const switchbot: IntegrationGuide = {
  id: 'switchbot',
  domain: 'iot',
  kind: 'switchbot',
  category: 'plugs',
  displayName: 'SwitchBot',
  vendor: 'SwitchBot',
  icon: 'Plug',
  tier: 2,
  intro:
    'SwitchBot has very versatile devices: from the "Bot" that physically presses a button to plugs and color bulbs. KrakenOS controls them through the SwitchBot Hub Mini or Hub 2, using their local access (without the cloud). You need to turn on that access in the app and copy a "token" that acts as a key.',
  prerequisites: [
    'A SwitchBot Hub Mini or Hub 2 (the other hub models do not work here).',
    'The SwitchBot app to turn on local control and obtain the token.',
    'The hub having a fixed IP in your router.',
  ],
  steps: [
    {
      title: 'Turn on local control in the app',
      body: 'Open the SwitchBot app, go into your Hub Mini/Hub 2 and turn on the "LAN API" or "local control" option (the name varies by version). Make sure the hub has a fixed IP reserved in your router.',
      external: true,
    },
    {
      title: 'Copy the token',
      body: 'In the SwitchBot app, go to "Profile → Preferences → Developer Options" and copy the "Token". It is a long key that authorizes access, like a password. Keep it handy for the next step.',
      note: 'Treat the token like a password: do not share it. It is stored encrypted.',
      external: true,
    },
    {
      title: 'Connect KrakenOS',
      body: 'Enter the hub address, its port (8123 by default) and the token. When you save, the compatible devices appear (Bot, Plug Mini, color bulbs, strips...). Sensors and locks are not shown in this version.',
    },
  ],
  fields: [
    {
      key: 'hubHost',
      label: 'Hub address',
      help: 'The IP of the Hub Mini/Hub 2 on your network, for example 192.168.1.90. It is best if it is fixed.',
      type: 'host',
      placeholder: '192.168.1.90',
      required: true,
    },
    {
      key: 'hubPort',
      label: 'Hub port',
      help: 'The "door" through which the hub responds. By default it is 8123.',
      type: 'number',
      required: false,
      defaultValue: 8123,
    },
    {
      key: 'token',
      label: 'Token',
      help: 'The key you copied from the developer mode of the SwitchBot app. It is stored encrypted.',
      type: 'password',
      required: true,
      secret: true,
    },
  ],
  troubleshooting: [
    {
      q: 'No device shows up.',
      a: 'Confirm that you turned on local control on the hub, that the token is correct and that the hub address and port are correct. Remember that a Hub Mini or Hub 2 is required.',
    },
    {
      q: 'I do not see my sensor or my lock.',
      a: 'This version only shows plugs and lights (Bot, Plug Mini, Color Bulb, Strip Light, Ceiling Light). Sensors, curtains and locks are filtered out for now.',
    },
  ],
};

export const PLUG_GUIDES_EN: IntegrationGuide[] = [kasa, tapo, shelly, meross, switchbot];
