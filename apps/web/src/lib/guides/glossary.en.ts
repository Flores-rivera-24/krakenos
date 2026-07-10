/**
 * English glossary of networking and smart-home jargon, in plain language (US-177).
 *
 * Each entry defines a term in 1-2 sentences for someone who has never heard of
 * an IP address. `short` is the one-line definition (ideal for a tooltip);
 * `long` expands when it helps. The key is a stable slug the UI can use to link
 * a word to its definition — identical to the Spanish `GLOSSARY` keys.
 */

import type { GlossaryEntry } from './glossary';

export const GLOSSARY_EN: Record<string, GlossaryEntry> = {
  ssid: {
    term: 'SSID',
    short: "It's the name of your WiFi network — the one that shows up in the list when you look for WiFi on your phone.",
    long: 'SSID means "wireless network name". When you change the name of your WiFi, you are changing the SSID. Each band (2.4 and 5 GHz) can share the same name or use a different one.',
  },
  'banda-24-5-6': {
    term: '2.4 / 5 / 6 GHz band',
    short: 'These are the "lanes" your WiFi travels on. The 2.4 GHz one reaches farther; the 5 and 6 GHz ones are faster but shorter-range.',
    long: 'Your router can broadcast WiFi on several frequencies. The 2.4 GHz band gets through walls better and reaches far, but it is slower and clogs up easily. The 5 and 6 GHz bands (the latter on WiFi 6E/7 gear) are much faster but lose strength over distance.',
  },
  rssi: {
    term: 'RSSI / signal',
    short: 'How strongly a device receives the WiFi. It is measured in dBm and is always a negative number: the closer to 0, the better.',
    long: 'RSSI is the received signal strength. -50 dBm is an excellent signal (you are right next to the router), -70 dBm is acceptable, and below -80 dBm the connection gets slow or drops. It is what colors the coverage heatmap.',
  },
  dbm: {
    term: 'dBm',
    short: 'The unit WiFi strength is measured in. It goes negative: -50 is a strong signal, -80 is a weak one.',
    long: 'dBm measures signal power. Because these are very small values, they are expressed as negatives: -50 dBm is far more signal than -80 dBm (every 10 dBm is 10 times more/less power).',
  },
  'mapa-calor-cobertura': {
    term: 'Coverage heatmap',
    short: 'A drawing of your home colored by WiFi strength in each corner: green where it reaches well, red where it reaches poorly.',
    long: 'KrakenOS estimates (or measures with your phone) the WiFi signal throughout the house and paints it over the floor plan: green = excellent signal, yellow = acceptable, red = weak or no coverage. It helps you decide where to place the router or an extra access point.',
  },
  wpa2: {
    term: 'WPA2',
    short: 'The lock that protects your WiFi with a password. It has been the standard for years and is secure for most homes.',
    long: 'WPA2 encrypts what travels over your WiFi so no one outside can read it. You need the password to get in. Its successor, WPA3, is even more secure.',
  },
  wpa3: {
    term: 'WPA3',
    short: 'The newest and most secure version of your WiFi lock. If your devices support it, it is the best option.',
    long: 'WPA3 improves on WPA2 by better protecting the password against guessing attempts. Some older devices only understand WPA2, which is why many routers offer a mixed WPA2/WPA3 mode.',
  },
  'red-invitados': {
    term: 'Guest network',
    short: 'A separate WiFi for visitors and untrusted gadgets that cannot see the rest of your home devices.',
    long: 'When someone connects to the guest network, they get internet but cannot reach your computer, your NAS or your cameras. It is ideal for visitors and for keeping "smart" gadgets separate from the rest.',
  },
  'direccion-ip': {
    term: 'IP address',
    short: 'The "phone number" of a device within your network: it lets gadgets find one another.',
    long: 'Every phone, computer or light bulb in your home has an IP address like 192.168.1.42. At home they usually start with 192.168 or 10. Without it, two devices would not know where to send their data.',
  },
  mac: {
    term: 'MAC address',
    short: 'The unique "serial number" of a device\'s network card, like aa:bb:cc:11:22:33.',
    long: 'Unlike the IP (which can change), the MAC is burned in at the factory on every device. KrakenOS uses it to recognize a gadget even if its IP changes, and to block it if needed.',
  },
  cidr: {
    term: 'CIDR / network mask',
    short: 'A shorthand for "which range of IP addresses makes up a network", e.g. 192.168.1.0/24.',
    long: 'The "/24" at the end says how many addresses fit in the network. A /24 is 256 addresses (192.168.1.0 to 192.168.1.255), which is typical at home. The network mask is another way of expressing the same thing (255.255.255.0).',
  },
  subred: {
    term: 'Subnet',
    short: 'A group of devices that share the same range of IP addresses and can talk to each other directly.',
    long: 'Your home is usually a single subnet. You can split it into several (for example, one for smart gadgets and another for your computers) so they do not mix; that is where VLANs come in.',
  },
  dhcp: {
    term: 'DHCP and "IP reservation"',
    short: 'DHCP is the system that hands out IP addresses automatically. The "reservation" pins a specific IP to a gadget so it does not change.',
    long: 'When a device connects, the router gives it an IP via DHCP. That IP can change over time. An "IP reservation" (or static IP) always assigns it the same one — very handy for cameras, bulbs and plugs you want to find by their address.',
  },
  gateway: {
    term: 'Gateway',
    short: 'The "exit door" of your network toward the internet: almost always your own router.',
    long: 'When a gadget wants to reach a website, it sends the traffic to the gateway, which pushes it out to the internet and brings back the answer. At home, the gateway is your router (often an IP like 192.168.1.1).',
  },
  vlan: {
    term: 'VLAN',
    short: 'A way to split your network into separate zones using the same wiring, like putting partitions in a large room.',
    long: 'With VLANs you can have, for example, the "home" zone and the "smart gadgets" zone isolated from each other even though they use the same router and switch. That way, if a cheap bulb had a security problem, it could not see your computers.',
  },
  dns: {
    term: 'DNS',
    short: 'The "contact book" of the internet: it translates names like google.com into the server\'s number (IP).',
    long: 'When you type a web address, your device asks DNS for its IP, just as you would look up a name in your contacts to get their number. If you change your DNS server (for example, to Pi-hole), you can filter ads and trackers.',
  },
  adblock: {
    term: 'Ad blocking (DNS ad-block)',
    short: 'Filter ads and trackers for the whole house from the DNS itself, without installing anything on each device.',
    long: 'A DNS blocker like Pi-hole has a list of advertising and tracking domains. When a gadget tries to load one, DNS answers "does not exist" and the ad never arrives. It works on phones, TVs and consoles alike.',
  },
  puerto: {
    term: 'Port',
    short: 'Like the "door number" within an IP address: it distinguishes which service answers (web, mail, camera...).',
    long: 'A single IP can offer several services at once, each on its own port. For example, websites usually use port 443 and RTSP cameras port 554. When the wizard asks you for a port, you can almost always keep the default one.',
  },
  protocolo: {
    term: 'Protocol (TCP / UDP)',
    short: 'The two "languages" data travels in over the network. TCP is careful and confirms delivery; UDP is fast and does not confirm.',
    long: 'TCP is used when it matters that nothing gets lost (web pages, files). UDP is used when speed matters and some loss is tolerable (live video, some smart gadgets). You rarely need to choose it by hand.',
  },
  qos: {
    term: 'QoS / bandwidth',
    short: 'Bandwidth is the "width of the pipe" of your internet. QoS shares that width to give priority to what matters.',
    long: 'If someone downloads something huge, it can knock out a video call. With QoS (Quality of Service) you give the video call priority or throttle the download, so the experience stays smooth for everyone.',
  },
  vpn: {
    term: 'VPN',
    short: 'A private, encrypted "tunnel" that connects you to your home network from outside, as if you were in the living room.',
    long: 'With a VPN, your phone joins your home network securely wherever you are. That way you reach KrakenOS and your devices without exposing anything to the internet: no one else can get through that tunnel without your key.',
  },
  wireguard: {
    term: 'WireGuard',
    short: 'The modern, fast and simple VPN technology KrakenOS uses for remote access.',
    long: 'WireGuard creates the encrypted VPN tunnel. You install its free app on your phone, scan a QR code that KrakenOS generates, and that is it: you are securely connected to home.',
  },
  rtsp: {
    term: 'RTSP',
    short: 'The "language" most IP cameras speak to stream their live video over the local network.',
    long: 'RTSP is a special address (it starts with rtsp://) that points to a camera\'s video. KrakenOS uses it to pull images from the camera without relying on the manufacturer\'s cloud.',
  },
  'bridge-hue': {
    term: 'Bridge (Hue bridge)',
    short: 'The little white Philips Hue box that connects your bulbs to the network. Without it, KrakenOS cannot see them.',
    long: 'Hue bulbs do not speak WiFi: they talk to the bridge, and the bridge connects to the router by cable. KrakenOS controls the lights through that bridge, inside your home and without going through the internet.',
  },
  'local-key': {
    term: 'Local key (Tuya local key)',
    short: 'A secret, unique password on each Tuya bulb or plug, needed to control it without the cloud.',
    long: 'Tuya devices (many cheap bulbs from Amazon) encrypt their local communication with this key. It does not show up in the app: you have to get it from the Tuya developer portal. If you re-pair the gadget, the key changes.',
  },
  token: {
    term: 'Token',
    short: 'A long, automatic password a service gives you so other apps can identify themselves without using your username and password.',
    long: 'Instead of entering your username and password, some gadgets (like the SwitchBot hub) give you a token: a string of letters and numbers that authorizes access. Treat it like a password and do not share it.',
  },
  ssh: {
    term: 'SSH',
    short: 'A secure way to give text commands to a network device (a router, a server) from another one.',
    long: 'SSH opens an encrypted "remote console". Some routers (OpenWrt, MikroTik, Cisco) let KrakenOS manage them over SSH with a username and password. It is plain text, no windows.',
  },
  firmware: {
    term: 'Firmware',
    short: 'The internal software that makes a device work, like the operating system of your router or your camera.',
    long: 'Firmware is the device\'s factory "brain". It is sometimes updated to fix bugs, and on some routers you can replace it with a free one (like OpenWrt) that offers more control.',
  },
  controladora: {
    term: 'Controller',
    short: 'A program or central box that manages all the access points and gear of one brand (UniFi, Omada).',
    long: 'In systems like Ubiquiti UniFi or TP-Link Omada, you do not configure each antenna separately: you talk to a central controller that coordinates them. KrakenOS connects to that controller, not to each device.',
  },
  'certificado-autofirmado': {
    term: 'Self-signed certificate',
    short: 'A security certificate a device creates for itself, valid inside your home even though the browser warns about it.',
    long: 'Many local devices (routers, bridges, controllers) use HTTPS with a certificate they sign themselves. The browser distrusts it because it does not come from a known authority, but on your own local network it is normal and safe to accept it.',
  },
  mqtt: {
    term: 'MQTT / broker',
    short: 'A lightweight "mail carrier" system that delivers messages between smart gadgets. The broker is the central post office.',
    long: 'Some devices (Zigbee via zigbee2mqtt, Meross) do not talk to KrakenOS directly: they drop off and pick up messages at an MQTT broker (like Mosquitto). KrakenOS connects to that broker to learn everything and send commands.',
  },
  'application-key': {
    term: 'Application key',
    short: 'A key a device (like the Hue bridge) hands you the first time so an app can control it.',
    long: 'For KrakenOS to control your Hue lights, the bridge has to grant permission once. You press the bridge\'s physical button and it generates this key, which is then saved so you do not have to repeat the permission.',
  },
};

/** Returns the glossary entry by its key, or undefined if it does not exist. */
export function getGlossaryEntryEn(key: string): GlossaryEntry | undefined {
  return GLOSSARY_EN[key];
}

/** Lists all glossary entries sorted alphabetically by term. */
export function glossaryEntriesEn(): (GlossaryEntry & { key: string })[] {
  return Object.entries(GLOSSARY_EN)
    .map(([key, entry]) => ({ key, ...entry }))
    .sort((a, b) => a.term.localeCompare(b.term, 'en'));
}
