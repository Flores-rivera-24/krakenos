import type { IntegrationGuide } from '../../types';

/**
 * Smart light guides (domain 'iot', category 'lights'):
 * Hue, Govee and Tuya (internalized from their docs) plus Zigbee and Matter
 * (no source doc: written from scratch in plain English).
 */

const hue: IntegrationGuide = {
  id: 'hue',
  domain: 'iot',
  kind: 'hue',
  category: 'lights',
  displayName: 'Philips Hue',
  vendor: 'Signify / Philips',
  icon: 'Lightbulb',
  tier: 2,
  intro:
    'Philips Hue is one of the best-known smart lighting systems. Its bulbs talk to a small white box called a "bridge", which connects to your router by cable. KrakenOS controls your lights through that bridge, all within your home and without going through the internet. You will be able to turn lights on and off, dim them and change their color from a single screen.',
  prerequisites: [
    'The Hue bridge connected to your router and working, with your bulbs already paired.',
    'Knowing the IP address of the bridge on your network (we help you find it).',
    'Physical access to the bridge to press its round button once.',
  ],
  steps: [
    {
      title: 'Find the bridge address',
      body: 'Look in the KrakenOS device list (or in your router) for the device whose manufacturer is "Philips" or "Signify": that is your bridge address. You can also visit the Philips discovery page from your network, which returns the internal IP of the bridge.',
      command: 'https://discovery.meethue.com/',
      external: true,
    },
    {
      title: 'Authorize KrakenOS with the bridge button',
      body: 'For KrakenOS to control your lights, the bridge has to grant it permission once. In this step, press the large round button on the bridge and then confirm in the app: KrakenOS obtains an "application key" that it stores so it never has to repeat the permission.',
      note: 'After pressing the button you have about 30 seconds to confirm. If time runs out, try again.',
      external: true,
    },
    {
      title: 'Save and test',
      body: 'Once authorized, your Hue lights show up on the devices screen. Try turning them on and off, raising the brightness and changing the color. If something does not respond, check that the bridge address is correct.',
    },
  ],
  fields: [
    {
      key: 'bridgeUrl',
      label: 'Bridge address',
      help: 'The address of the Hue bridge on your network, starting with https://. For example https://192.168.1.50.',
      type: 'url',
      placeholder: 'https://192.168.1.50',
      required: true,
    },
    {
      key: 'appKey',
      label: 'Application key',
      help: 'The key the bridge generates when you press its button. If the wizard obtains it for you during authorization, you do not have to type anything. It is stored encrypted.',
      type: 'password',
      required: true,
      secret: true,
    },
  ],
  troubleshooting: [
    {
      q: 'When authorizing it says I did not press the button in time.',
      a: 'Press the round button on the bridge and, immediately afterward (within 30 seconds), confirm in the app. If you are too slow, the bridge rejects the request and you have to repeat.',
    },
    {
      q: 'My bulbs do not show up.',
      a: 'Check that the bulbs are paired with the bridge (they appear in the official Hue app) and that the bridge address is correct.',
    },
    {
      q: 'The system warns about an untrusted bridge certificate.',
      a: 'The bridge uses a certificate it creates itself for your local network. This is normal on a connection inside your home and is not a security problem.',
    },
  ],
};

const govee: IntegrationGuide = {
  id: 'govee',
  domain: 'iot',
  kind: 'govee',
  category: 'lights',
  displayName: 'Govee',
  vendor: 'Govee',
  icon: 'Lightbulb',
  tier: 1,
  intro:
    'Govee makes very popular, affordable LED strips and lights. Many of its models support "local control", meaning you can let KrakenOS manage them directly over your WiFi network without going through the Govee cloud. It is one of the easiest to connect: just turn on an option in the Govee app. You will be able to turn lights on and off, dim them and change their color.',
  prerequisites: [
    'Govee lights that support "LAN Control" (local control). Not every model has it.',
    'The Govee Home app installed on your phone.',
    'The KrakenOS server and the lights on the same WiFi network (same subnet).',
  ],
  steps: [
    {
      title: 'Turn on "LAN Control" in the Govee app',
      body: 'Local control is off by default. For each light or strip: open the Govee Home app, go into the device, tap the settings icon (top right) and turn on "LAN Control". If that option does not appear, that model cannot be controlled locally.',
      external: true,
    },
    {
      title: 'Make sure they are on the same network',
      body: 'KrakenOS discovers Govee lights by sending a "hello" across the local network. For it to arrive, the KrakenOS server and the lights must be on the same WiFi network. If you keep your smart devices on a separate network (VLAN), this discovery does not cross from one network to another on its own.',
      note: 'The Govee local protocol uses no password or token, which is why it is a good idea to keep smart devices on their own network.',
      external: true,
    },
    {
      title: 'Save and wait a few seconds',
      body: 'No key is needed. When you save, the lights appear as they respond (it may take a few seconds). If you want, you can specify a particular listening port; if not, the usual one is used.',
    },
  ],
  fields: [
    {
      key: 'listenPort',
      label: 'Listening port (optional)',
      help: 'The "door" through which KrakenOS listens for the lights\' replies. Leave it empty to use the usual value of the Govee protocol (4002).',
      type: 'number',
      placeholder: '4002',
      required: false,
    },
  ],
  troubleshooting: [
    {
      q: 'No Govee light shows up.',
      a: 'Confirm that you turned on "LAN Control" on each device, that the server is on the same WiFi network as the lights and that the server firewall does not block the traffic. Reloading the devices screen launches a new scan.',
    },
    {
      q: 'I cannot find "LAN Control" in the app.',
      a: 'That particular model does not support local control and would only work through the Govee cloud, which is outside KrakenOS. Check the model compatibility.',
    },
  ],
};

const tuya: IntegrationGuide = {
  id: 'tuya',
  domain: 'iot',
  kind: 'tuya',
  category: 'lights',
  displayName: 'Tuya / Smart Life',
  vendor: 'Tuya (white-label brands: EASYTAO and similar)',
  icon: 'Lightbulb',
  tier: 4,
  intro:
    'Many cheap "smart" lights from Amazon (EASYTAO and similar) run internally on Tuya technology, even though the brand is something else. KrakenOS can control them locally, without the cloud, but to do so it needs a secret key from each light (the "local key"). Getting that key is the laborious part: you have to create a free account on the Tuya developer portal. It is the light integration with the most steps.',
  prerequisites: [
    'The lights already paired in the Smart Life (or Tuya Smart) app and connected to your WiFi.',
    'A free account on the Tuya developer portal (iot.tuya.com) to obtain the keys.',
    'The local IP address of each light (better if you reserve a fixed IP for it in the router).',
    'For each light you will need three pieces of data: its identifier (Device ID), its local key (Local Key) and its IP.',
  ],
  steps: [
    {
      title: 'Pair the lights in Smart Life',
      body: 'Install the Smart Life (or Tuya Smart) app on your phone, create an account and pair each light following the app, so they end up connected to your WiFi. This is the normal way to use these lights.',
      external: true,
    },
    {
      title: 'Obtain the Device ID and the Local Key',
      body: 'The local key is not in the app: you have to get it from the Tuya developer portal. Create a free account at iot.tuya.com, create a cloud project, link your Smart Life account and, in the device list, you will see the "Device ID" and the "Local Key" of each light. It is a somewhat technical process but you only do it once.',
      command: 'https://iot.tuya.com',
      note: 'A more convenient alternative: the official tool "npx @tuyapi/cli wizard" lists each light with its id, its key and its IP from the project credentials.',
      external: true,
    },
    {
      title: 'Find the IP of each light',
      body: 'Look up the IP address of each light in your router or in the KrakenOS device list (search by manufacturer or name). Highly recommended: reserve a fixed IP for each light in the router, so it does not change over time and they do not disconnect.',
      external: true,
    },
    {
      title: 'Register each light in KrakenOS',
      body: 'Add each light with its name, its IP, its Device ID and its Local Key. Choose the protocol version (if you do not know it, try 3.3, the most common). The local key is stored encrypted and is never shown again. Repeat for each light you want to control.',
    },
  ],
  fields: [
    {
      key: 'name',
      label: 'Light name',
      help: 'A name to recognize it by, for example "Living room light".',
      type: 'text',
      placeholder: 'Living room light',
      required: true,
    },
    {
      key: 'ip',
      label: 'Light IP address',
      help: 'The local IP of the light on your network. Better if it is a fixed IP reserved in the router.',
      type: 'ip',
      placeholder: '192.168.1.80',
      required: true,
    },
    {
      key: 'deviceId',
      label: 'Identifier (Device ID)',
      help: 'The unique identifier of the light that appears in the Tuya developer portal.',
      type: 'text',
      placeholder: 'bf1234567890abcdef',
      required: true,
    },
    {
      key: 'localKey',
      label: 'Local key (Local Key)',
      help: 'The secret key of the light obtained from the Tuya portal. It is stored encrypted and never shown again. If you re-pair the light, this key changes.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'version',
      label: 'Protocol version',
      help: 'The Tuya protocol version of the light. If you do not know it, try 3.3 (the most common).',
      type: 'select',
      required: false,
      defaultValue: '3.3',
      options: [
        { value: '3.1', label: '3.1' },
        { value: '3.3', label: '3.3 (common)' },
        { value: '3.4', label: '3.4' },
      ],
    },
  ],
  troubleshooting: [
    {
      q: 'A light suddenly stops responding.',
      a: 'The most likely cause is that the local key has changed (this happens if you unlink and re-link the light in Smart Life). Get the key again from the Tuya portal and update it on the light.',
    },
    {
      q: 'The light shows as "not reachable".',
      a: 'Check that the IP is correct and has not changed (which is why it is worth reserving it as fixed), and that the light is powered on and on your WiFi. Its last known state is shown.',
    },
    {
      q: 'Can I change the color?',
      a: 'For now these lights are controlled with on/off and brightness. Color control for Tuya is an improvement planned for later.',
    },
  ],
};

const zigbee: IntegrationGuide = {
  id: 'zigbee',
  domain: 'iot',
  kind: 'zigbee',
  category: 'lights',
  displayName: 'Zigbee (zigbee2mqtt)',
  vendor: 'Various (IKEA Trådfri, Aqara, Sonoff...)',
  icon: 'Lightbulb',
  tier: 3,
  intro:
    'Zigbee is a low-power technology used by a great many bulbs, sensors and plugs from different brands (IKEA Trådfri, Aqara, Sonoff and more). To control them without the cloud, a program called zigbee2mqtt is used, which acts as a translator between your Zigbee devices and your network. KrakenOS connects to that translator through a message "mailman" (an MQTT broker) to manage your lights.',
  prerequisites: [
    'A Zigbee adapter (a kind of USB stick) connected to your server.',
    'The zigbee2mqtt program installed and running, with your devices already paired.',
    'An MQTT broker (for example Mosquitto) on your network, which is where zigbee2mqtt publishes the messages.',
  ],
  steps: [
    {
      title: 'Have zigbee2mqtt and the broker running',
      body: 'Before connecting KrakenOS, you need two things running on your server: an MQTT broker (like Mosquitto), which is the "mailman" that delivers the messages, and the zigbee2mqtt program, which talks to your Zigbee devices and publishes their states to the broker. Pair your bulbs in zigbee2mqtt.',
      external: true,
    },
    {
      title: 'Note down the broker address',
      body: 'You need the address of the MQTT broker, which starts with "mqtt://" followed by the IP and the port (the usual one is 1883). For example mqtt://192.168.1.5:1883. It also helps to know the "base topic" that zigbee2mqtt uses for its messages (by default it is "zigbee2mqtt").',
      external: true,
    },
    {
      title: 'Connect KrakenOS',
      body: 'Enter the broker address and the base topic. When you save, KrakenOS subscribes to the messages from your Zigbee devices and shows them as lights you can control.',
    },
  ],
  fields: [
    {
      key: 'brokerUrl',
      label: 'MQTT broker address',
      help: 'The address of the message "mailman", starting with mqtt://. For example mqtt://192.168.1.5:1883.',
      type: 'url',
      placeholder: 'mqtt://192.168.1.5:1883',
      required: true,
    },
    {
      key: 'baseTopic',
      label: 'Base topic',
      help: 'The name zigbee2mqtt uses for its messages. By default it is "zigbee2mqtt"; leave it as is unless you changed it.',
      type: 'text',
      placeholder: 'zigbee2mqtt',
      required: false,
      defaultValue: 'zigbee2mqtt',
    },
  ],
  troubleshooting: [
    {
      q: 'No Zigbee device shows up.',
      a: 'Check that zigbee2mqtt is running and has paired your devices, that the MQTT broker is running, and that the broker address and the base topic are correct.',
    },
    {
      q: 'What exactly is an MQTT broker?',
      a: 'It is a program that acts as a post office: devices leave messages there and KrakenOS picks them up, and vice versa. Mosquitto is the most common and is free.',
    },
  ],
};

const matter: IntegrationGuide = {
  id: 'matter',
  domain: 'iot',
  kind: 'matter',
  category: 'lights',
  displayName: 'Matter',
  vendor: 'Various (Matter standard)',
  icon: 'Lightbulb',
  tier: 3,
  intro:
    'Matter is a new standard that aims to let smart devices from different brands understand each other. To control them locally, a small service ("matter-server") is used that acts as an intermediary. KrakenOS connects to it to manage your lights and other Matter-compatible devices, all within your home.',
  prerequisites: [
    'A matter-server service running on your network, with your Matter devices already commissioned.',
    'The connection address of that service (starts with ws://).',
  ],
  steps: [
    {
      title: 'Have the matter-server running',
      body: 'Install and start a matter-server on your server or network and commission your Matter devices in it. This service is what actually talks to the devices; KrakenOS relies on it.',
      external: true,
    },
    {
      title: 'Note down the connection address',
      body: 'The matter-server offers a connection address that starts with "ws://" (a real-time connection). For example ws://192.168.1.5:5580/ws. That is the address you will enter below.',
      external: true,
    },
    {
      title: 'Connect KrakenOS',
      body: 'Paste the connection address of the matter-server. When you save, KrakenOS links up with it and shows your Matter devices ready to control.',
    },
  ],
  fields: [
    {
      key: 'serverUrl',
      label: 'matter-server address',
      help: 'The real-time connection address of the service, starting with ws://. For example ws://192.168.1.5:5580/ws.',
      type: 'url',
      placeholder: 'ws://192.168.1.5:5580/ws',
      required: true,
    },
  ],
  troubleshooting: [
    {
      q: 'It does not connect to the matter-server.',
      a: 'Verify that the service is running and reachable from the KrakenOS server, and that the address starts with ws:// with the correct port.',
    },
    {
      q: 'I do not see my Matter devices.',
      a: 'The devices must be commissioned inside the matter-server. KrakenOS only shows what that service already manages.',
    },
  ],
};

export const LIGHT_GUIDES_EN: IntegrationGuide[] = [hue, govee, tuya, zigbee, matter];
