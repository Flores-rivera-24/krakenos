import type { GuideTranslations } from '../localize';

/**
 * Traducción al inglés de las guías de lights (US-177). Superpone solo el texto
 * visible sobre la fuente en español (`integrations/lights.ts`); la estructura la
 * toma el original.
 */
export const LIGHTS_GUIDES_EN: GuideTranslations = {
  hue: {
    displayName: 'Philips Hue',
    vendor: 'Signify / Philips',
    intro:
      'Philips Hue is one of the best-known smart lighting systems. Its bulbs talk to a small white box called the “bridge”, which connects to your router by cable. KrakenOS controls your lights through that bridge, all inside your home and without going through the internet. You will be able to turn them on and off, dim the brightness and change the color from a single screen.',
    prerequisites: [
      'The Hue bridge connected to your router and working, with your bulbs already paired.',
      'Knowing the bridge’s IP address on your network (we help you find it).',
      'Physical access to the bridge to press its round button once.',
    ],
    steps: [
      {
        title: 'Find the bridge’s address',
        body: 'Look in the KrakenOS device list (or in your router) for the device whose manufacturer is “Philips” or “Signify”: that is your bridge’s address. You can also visit the Philips discovery page from your network, which returns the bridge’s internal IP.',
      },
      {
        title: 'Authorize KrakenOS with the bridge button',
        body: 'For KrakenOS to control your lights, the bridge has to grant it permission once. In this step, press the large round button on the bridge and then confirm in the app: KrakenOS will get an “application key” that it stores so it doesn’t have to ask for permission again.',
        note: 'After pressing the button you have about 30 seconds to confirm. If the time runs out, try again.',
      },
      {
        title: 'Save and test',
        body: 'Once authorized, your Hue lights appear on the devices screen. Try turning them on and off, raising the brightness and changing the color. If something doesn’t respond, check that the bridge’s address is correct.',
      },
    ],
    fields: {
      bridgeUrl: {
        label: 'Bridge address',
        help: 'The address of the Hue bridge on your network, starting with https://. For example https://192.168.1.50.',
        placeholder: 'https://192.168.1.50',
      },
      appKey: {
        label: 'Application key',
        help: 'The key the bridge generates when you press its button. If the assistant obtains it for you during authorization, you don’t have to type anything. It is stored encrypted.',
      },
    },
    troubleshooting: [
      {
        q: 'When authorizing, it says I didn’t press the button in time.',
        a: 'Press the round button on the bridge and, immediately after (less than 30 seconds), confirm in the app. If you take too long, the bridge rejects the request and you have to repeat it.',
      },
      {
        q: 'My bulbs don’t appear.',
        a: 'Check that the bulbs are paired with the bridge (they show up in the official Hue app) and that the bridge’s address is correct.',
      },
      {
        q: 'The system warns about an untrusted bridge certificate.',
        a: 'The bridge uses a certificate it created itself for your local network. This is normal for a connection inside your home and is not a security problem.',
      },
    ],
  },
  govee: {
    displayName: 'Govee',
    vendor: 'Govee',
    intro:
      'Govee makes very popular and affordable LED strips and lights. Many of its models allow “local control”, that is, letting KrakenOS manage them directly over your WiFi network without going through Govee’s cloud. It is one of the easiest to connect: you just turn on an option in the Govee app. You will be able to turn them on and off, dim the brightness and change the color.',
    prerequisites: [
      'Govee lights that support “LAN Control” (local control). Not all models have it.',
      'The Govee Home app installed on your phone.',
      'The KrakenOS server and the lights on the same WiFi network (same subnet).',
    ],
    steps: [
      {
        title: 'Turn on “LAN Control” in the Govee app',
        body: 'Local control is off by default. For each light or strip: open the Govee Home app, go into the device, tap the settings icon (top right) and turn on “LAN Control”. If that option doesn’t appear, that model can’t be controlled locally.',
      },
      {
        title: 'Make sure they are on the same network',
        body: 'KrakenOS discovers Govee lights by sending a “notice” over the local network. For it to arrive, the KrakenOS server and the lights must be on the same WiFi network. If you keep your smart devices on a separate network (VLAN), this discovery does not cross from one network to another on its own.',
        note: 'Govee’s local protocol uses no password or token, which is why it’s a good idea to keep smart devices on their own network.',
      },
      {
        title: 'Save and wait a few seconds',
        body: 'No key is needed. When you save, the lights show up as they respond (it can take a few seconds). If you want, you can set a specific listening port; if not, the usual one is used.',
      },
    ],
    fields: {
      listenPort: {
        label: 'Listening port (optional)',
        help: 'The “door” through which KrakenOS listens for the lights’ replies. Leave it empty to use the Govee protocol’s usual value (4002).',
        placeholder: '4002',
      },
    },
    troubleshooting: [
      {
        q: 'No Govee light appears.',
        a: 'Confirm that you turned on “LAN Control” on each device, that the server is on the same WiFi network as the lights, and that the server’s firewall does not block the traffic. Reloading the devices screen launches a new scan.',
      },
      {
        q: 'I can’t find “LAN Control” in the app.',
        a: 'That particular model does not support local control and would only work through Govee’s cloud, which is outside KrakenOS. Check the model’s compatibility.',
      },
    ],
  },
  tuya: {
    displayName: 'Tuya / Smart Life',
    vendor: 'Tuya (white-label brands: EASYTAO and similar)',
    intro:
      'Many cheap “smart” lights from Amazon (EASYTAO and similar) run internally on Tuya technology, even if the brand is something else. KrakenOS can control them locally, without the cloud, but to do so it needs a secret key from each light (the “local key”). Getting that key is the laborious part: you have to create a free account on the Tuya developer portal. It is the lighting integration with the most steps.',
    prerequisites: [
      'The lights already paired in the Smart Life (or Tuya Smart) app and connected to your WiFi.',
      'A free account on the Tuya developer portal (iot.tuya.com) to obtain the keys.',
      'The local IP address of each light (better if you reserve a fixed IP for it on the router).',
      'For each light you will need three pieces of data: its identifier (Device ID), its local key (Local Key) and its IP.',
    ],
    steps: [
      {
        title: 'Pair the lights in Smart Life',
        body: 'Install the Smart Life (or Tuya Smart) app on your phone, create an account and pair each light by following the app, so they end up connected to your WiFi. This is the normal way these lights are used.',
      },
      {
        title: 'Get the Device ID and the Local Key',
        body: 'The local key is not in the app: you have to get it from the Tuya developer portal. Create a free account on iot.tuya.com, create a cloud project, link your Smart Life account and, in the device list, you will see the “Device ID” and the “Local Key” of each light. It is a somewhat technical process but you only do it once.',
        note: 'A more convenient alternative: the official tool “npx @tuyapi/cli wizard” lists each light with its id, its key and its IP based on the project credentials.',
      },
      {
        title: 'Find out each light’s IP',
        body: 'Look up each light’s IP address in your router or in the KrakenOS device list (search by manufacturer or name). Highly recommended: reserve a fixed IP for each light on the router, so it doesn’t change over time and they don’t drop off.',
      },
      {
        title: 'Register each light in KrakenOS',
        body: 'Add each light with its name, its IP, its Device ID and its Local Key. Choose the protocol version (if you don’t know it, try 3.3, the most common). The local key is stored encrypted and never shown again. Repeat for each light you want to control.',
      },
    ],
    fields: {
      name: {
        label: 'Light name',
        help: 'A name to recognize it, for example “Living room light”.',
        placeholder: 'Living room light',
      },
      ip: {
        label: 'Light IP address',
        help: 'The light’s local IP on your network. Better if it is a fixed IP reserved on the router.',
        placeholder: '192.168.1.80',
      },
      deviceId: {
        label: 'Identifier (Device ID)',
        help: 'The light’s unique identifier that appears on the Tuya developer portal.',
        placeholder: 'bf1234567890abcdef',
      },
      localKey: {
        label: 'Local key (Local Key)',
        help: 'The light’s secret key obtained from the Tuya portal. It is stored encrypted and never shown again. If you re-pair the light, this key changes.',
      },
      version: {
        label: 'Protocol version',
        help: 'The light’s Tuya protocol version. If you don’t know it, try 3.3 (the most common).',
        options: {
          '3.1': '3.1',
          '3.3': '3.3 (common)',
          '3.4': '3.4',
        },
      },
    },
    troubleshooting: [
      {
        q: 'A light suddenly stops responding.',
        a: 'The most likely cause is that the local key has changed (this happens if you unlink and re-link the light in Smart Life). Get the key from the Tuya portal again and update it on the light.',
      },
      {
        q: 'The light shows up as “not reachable”.',
        a: 'Check that the IP is correct and hasn’t changed (which is why it’s worth reserving it as fixed), and that the light is on and on your WiFi. Its last known state is shown.',
      },
      {
        q: 'Can I change the color?',
        a: 'For now these lights are controlled with on/off and brightness. Color control for Tuya is an improvement planned for later.',
      },
    ],
  },
  zigbee: {
    displayName: 'Zigbee (zigbee2mqtt)',
    vendor: 'Various (IKEA Trådfri, Aqara, Sonoff…)',
    intro:
      'Zigbee is a low-power technology used by a great many bulbs, sensors and plugs from different brands (IKEA Trådfri, Aqara, Sonoff and more). To control them without the cloud you use a program called zigbee2mqtt, which acts as a translator between your Zigbee devices and your network. KrakenOS connects to that translator through a message “mail carrier” (an MQTT broker) to manage your lights.',
    prerequisites: [
      'A Zigbee adapter (a kind of USB stick) connected to your server.',
      'The zigbee2mqtt program installed and running, with your devices already paired.',
      'An MQTT broker (for example Mosquitto) on your network, which is where zigbee2mqtt publishes the messages.',
    ],
    steps: [
      {
        title: 'Have zigbee2mqtt and the broker running',
        body: 'Before connecting KrakenOS, you need two things running on your server: an MQTT broker (like Mosquitto), which is the “mail carrier” that delivers the messages, and the zigbee2mqtt program, which talks to your Zigbee devices and publishes their states to the broker. Pair your bulbs in zigbee2mqtt.',
      },
      {
        title: 'Note down the broker’s address',
        body: 'You need the MQTT broker’s address, which starts with “mqtt://” followed by the IP and the port (the usual one is 1883). For example mqtt://192.168.1.5:1883. It’s also good to know the “base topic” that zigbee2mqtt uses for its messages (by default it is “zigbee2mqtt”).',
      },
      {
        title: 'Connect KrakenOS',
        body: 'Enter the broker’s address and the base topic. When you save, KrakenOS subscribes to the messages from your Zigbee devices and shows them as lights you can control.',
      },
    ],
    fields: {
      brokerUrl: {
        label: 'MQTT broker address',
        help: 'The address of the message “mail carrier”, starting with mqtt://. For example mqtt://192.168.1.5:1883.',
        placeholder: 'mqtt://192.168.1.5:1883',
      },
      baseTopic: {
        label: 'Base topic',
        help: 'The name zigbee2mqtt uses for its messages. By default it is “zigbee2mqtt”; leave it as is unless you have changed it.',
        placeholder: 'zigbee2mqtt',
      },
    },
    troubleshooting: [
      {
        q: 'No Zigbee device appears.',
        a: 'Check that zigbee2mqtt is running and has paired your devices, that the MQTT broker is up, and that the broker’s address and the base topic are correct.',
      },
      {
        q: 'What exactly is an MQTT broker?',
        a: 'It is a program that acts as a post office: devices leave messages there and KrakenOS picks them up, and vice versa. Mosquitto is the most common one and it is free.',
      },
    ],
  },
  matter: {
    displayName: 'Matter',
    vendor: 'Various (Matter standard)',
    intro:
      'Matter is a new standard that aims to let smart devices from different brands understand each other. To control them locally you use a small service (“matter-server”) that acts as an intermediary. KrakenOS connects to it to manage your lights and other Matter-compatible devices, all inside your home.',
    prerequisites: [
      'A matter-server service running on your network, with your Matter devices already linked.',
      'The connection address of that service (it starts with ws://).',
    ],
    steps: [
      {
        title: 'Have the matter-server running',
        body: 'Install and start a matter-server on your server or network and link your Matter devices to it. This service is the one that actually talks to the devices; KrakenOS relies on it.',
      },
      {
        title: 'Note down the connection address',
        body: 'The matter-server offers a connection address that starts with “ws://” (a real-time connection). For example ws://192.168.1.5:5580/ws. That is the address you will enter below.',
      },
      {
        title: 'Connect KrakenOS',
        body: 'Paste the matter-server’s connection address. When you save, KrakenOS links up with it and shows your Matter devices ready to control.',
      },
    ],
    fields: {
      serverUrl: {
        label: 'matter-server address',
        help: 'The service’s real-time connection address, starting with ws://. For example ws://192.168.1.5:5580/ws.',
        placeholder: 'ws://192.168.1.5:5580/ws',
      },
    },
    troubleshooting: [
      {
        q: 'It doesn’t connect to the matter-server.',
        a: 'Verify that the service is running and reachable from the KrakenOS server, and that the address starts with ws:// with the correct port.',
      },
      {
        q: 'I don’t see my Matter devices.',
        a: 'The devices must be linked inside the matter-server. KrakenOS only shows what that service already manages.',
      },
    ],
  },
};
