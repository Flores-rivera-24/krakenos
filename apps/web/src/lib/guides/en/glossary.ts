import type { GlossaryTranslations } from '../localize';

/**
 * Traducción al inglés del glosario (US-177). Superpone `term`/`short`/`long`
 * sobre la fuente en español (`glossary.ts`); las claves y su presencia las define
 * el original.
 */
export const GLOSSARY_EN: GlossaryTranslations = {
  ssid: {
    term: 'SSID',
    short: 'It is the name of your WiFi network, the one that shows up in the list when you search for WiFi on your phone.',
    long: 'SSID means “name of the wireless network”. When you change the name of your WiFi, you are changing the SSID. Each band (2.4 and 5 GHz) can use the same name or a different one.',
  },
  'banda-24-5-6': {
    term: '2.4 / 5 / 6 GHz band',
    short: 'They are the “lanes” your WiFi travels on. The 2.4 GHz one reaches farther; the 5 and 6 GHz ones are faster but cover less distance.',
    long: 'Your router can broadcast WiFi on several frequencies. The 2.4 GHz band goes through walls better and reaches far, but it is slower and gets crowded easily. The 5 and 6 GHz bands (the latter on WiFi 6E/7 gear) are much faster but lose strength over distance.',
  },
  rssi: {
    term: 'RSSI / signal',
    short: 'How strongly a device receives the WiFi. It is measured in dBm and is always a negative number: the closer to 0, the better.',
    long: 'RSSI is the strength of the received signal. -50 dBm is an excellent signal (you are right next to the router), -70 dBm is acceptable, and below -80 dBm the connection is slow or drops. It is what colors the coverage heatmap.',
  },
  dbm: {
    term: 'dBm',
    short: 'The unit WiFi strength is measured in. It runs negative: -50 is a strong signal, -80 is a weak one.',
    long: 'dBm measures the power of the signal. Since these are very small values, they are shown as negatives: -50 dBm is far more signal than -80 dBm (every 10 dBm is 10 times more/less power).',
  },
  'mapa-calor-cobertura': {
    term: 'Coverage heatmap',
    short: 'A drawing of your home colored by how strong the WiFi is in each corner: green where it reaches well, red where it does not.',
    long: 'KrakenOS estimates (or measures with your phone) the WiFi signal throughout the house and paints it over the floor plan: green = excellent signal, yellow = acceptable, red = weak or no coverage. It helps you decide where to place the router or an extra access point.',
  },
  wpa2: {
    term: 'WPA2',
    short: 'It is the lock that protects your WiFi with a password. It has been the standard for years and is secure for most homes.',
    long: 'WPA2 encrypts what travels over your WiFi so nobody outside can read it. You need the password to get in. Its successor, WPA3, is even more secure.',
  },
  wpa3: {
    term: 'WPA3',
    short: 'The newest and most secure version of your WiFi lock. If your devices support it, it is the best choice.',
    long: 'WPA3 improves on WPA2 by better protecting the password against guessing attempts. Some older devices only understand WPA2, which is why many routers offer a mixed WPA2/WPA3 mode.',
  },
  'red-invitados': {
    term: 'Guest network',
    short: 'A separate WiFi for visitors and untrusted gadgets that cannot see the rest of your home devices.',
    long: 'When connected to the guest network, someone has internet but cannot reach your computer, your NAS or your cameras. It is ideal for visitors and for keeping “smart” gadgets apart from everything else.',
  },
  'direccion-ip': {
    term: 'IP address',
    short: 'It is the “phone number” of a device inside your network: it lets gadgets find each other.',
    long: 'Every phone, computer or light bulb in your home has an IP address like 192.168.1.42. At home they usually start with 192.168 or 10. Without it, two devices would not know where to send each other data.',
  },
  mac: {
    term: 'MAC address',
    short: 'It is the unique “serial number” of a device’s network card, like aa:bb:cc:11:22:33.',
    long: 'Unlike the IP (which can change), the MAC is burned in at the factory on every device. KrakenOS uses it to recognize a gadget even if its IP changes, and to block it if needed.',
  },
  cidr: {
    term: 'CIDR / network mask',
    short: 'A short way of saying “which range of IP addresses makes up a network”, e.g. 192.168.1.0/24.',
    long: 'The “/24” at the end tells you how many addresses fit in the network. A /24 is 256 addresses (192.168.1.0 to 192.168.1.255), which is typical at home. The network mask is another way of saying the same thing (255.255.255.0).',
  },
  subred: {
    term: 'Subnet',
    short: 'A group of devices that share the same range of IP addresses and can talk to each other directly.',
    long: 'Your home is usually a single subnet. You can split it into several (for example, one for smart gadgets and another for your computers) so they do not mix; that is where VLANs come in.',
  },
  dhcp: {
    term: 'DHCP and “IP reservation”',
    short: 'DHCP is the system that hands out IP addresses automatically. The “reservation” pins a specific IP to a device so it does not change.',
    long: 'When a device connects, the router gives it an IP through DHCP. That IP can change over time. An “IP reservation” (or fixed IP) always assigns it the same one, which is very handy for cameras, bulbs and plugs you want to locate by their address.',
  },
  gateway: {
    term: 'Gateway',
    short: 'It is the “exit door” of your network toward the internet: almost always, your own router.',
    long: 'When a gadget wants to reach a website, it sends the traffic to the gateway, which pushes it out to the internet and brings back the answer. At home, the gateway is your router (often an IP like 192.168.1.1).',
  },
  vlan: {
    term: 'VLAN',
    short: 'A way to split your network into separate zones using the same wiring, like adding partitions to a large room.',
    long: 'With VLANs you can have, for example, the “home” zone and the “smart gadgets” zone isolated from each other even though they use the same router and switch. That way, if a cheap bulb had a security problem, it would not see your computers.',
  },
  dns: {
    term: 'DNS',
    short: 'It is the “contacts list” of the internet: it translates names like google.com into the server’s number (IP).',
    long: 'When you type a web address, your device asks DNS for its IP, just as you would look up a name in your contacts to get its number. If you change your DNS server (to Pi-hole, for example), you can filter ads and trackers.',
  },
  adblock: {
    term: 'Ad blocking (DNS ad-block)',
    short: 'Filtering ads and trackers for the whole house from DNS itself, without installing anything on each device.',
    long: 'A DNS blocker like Pi-hole has a list of advertising and tracking domains. When a gadget tries to load one, DNS answers “does not exist” and the ad never arrives. It works on phones, TVs and consoles alike.',
  },
  puerto: {
    term: 'Port',
    short: 'It is like the “door number” within an IP address: it tells which service is answering (web, mail, camera…).',
    long: 'A single IP can offer several services at once, each on its own port. For example, websites usually use port 443 and RTSP cameras port 554. When the assistant asks you for a port, you can almost always leave the default one.',
  },
  protocolo: {
    term: 'Protocol (TCP / UDP)',
    short: 'They are the two “languages” data travels in over the network. TCP is careful and confirms delivery; UDP is fast and unconfirmed.',
    long: 'TCP is used when it matters that nothing is lost (web pages, files). UDP is used when speed matters and losses are tolerable (live video, some smart gadgets). You usually do not need to pick it by hand.',
  },
  qos: {
    term: 'QoS / bandwidth',
    short: 'Bandwidth is the “width of the pipe” to the internet. QoS shares that width to give priority to what matters.',
    long: 'If someone downloads something huge, it can leave a video call without connection. With QoS (Quality of Service) you give the video call priority or limit the download, so the experience stays smooth for everyone.',
  },
  vpn: {
    term: 'VPN',
    short: 'A private, encrypted “tunnel” that connects you to your home network from outside, as if you were in the living room.',
    long: 'With a VPN, your phone joins your home network securely wherever you are. That way you reach KrakenOS and your devices without exposing anything to the internet: nobody else can get in through that tunnel without your key.',
  },
  wireguard: {
    term: 'WireGuard',
    short: 'The modern, fast and simple VPN technology KrakenOS uses for remote access.',
    long: 'WireGuard creates the encrypted VPN tunnel. You install its free app on your phone, scan a QR code that KrakenOS generates, and that is it: you are securely connected to home.',
  },
  rtsp: {
    term: 'RTSP',
    short: 'The “language” most IP cameras speak to stream their live video over the local network.',
    long: 'RTSP is a special address (it starts with rtsp://) that points to a camera’s video. KrakenOS uses it to pull the camera’s images without relying on the manufacturer’s cloud.',
  },
  'bridge-hue': {
    term: 'Bridge (Hue bridge)',
    short: 'The little white Philips Hue box that connects your bulbs to the network. Without it, KrakenOS cannot see them.',
    long: 'Hue bulbs do not speak WiFi: they talk to the bridge, and the bridge connects to the router by cable. KrakenOS controls the lights through that bridge, inside your home and without going through the internet.',
  },
  'local-key': {
    term: 'Local key (Tuya local key)',
    short: 'A secret, unique password on each Tuya bulb or plug, needed to control it without the cloud.',
    long: 'Tuya devices (many cheap Amazon lights) encrypt their local communication with this key. It does not show up in the app: you have to get it from the Tuya developer portal. If you re-pair the device, the key changes.',
  },
  token: {
    term: 'Token',
    short: 'A long, automatic password a service gives you so other apps can identify themselves without using your username and password.',
    long: 'Instead of entering your username and password, some devices give you a token: a string of letters and numbers that authorizes access. Treat it like a password and do not share it.',
  },
  ssh: {
    term: 'SSH',
    short: 'A secure way to give text commands to a device on the network (a router, a server) from another one.',
    long: 'SSH opens an encrypted “remote console”. Some routers (OpenWrt, MikroTik) let KrakenOS manage them over SSH with a username and password. It is plain text, no windows.',
  },
  firmware: {
    term: 'Firmware',
    short: 'The internal program that makes a device work, like the operating system of your router or your camera.',
    long: 'Firmware is the device’s factory “brain”. It is sometimes updated to fix bugs, and on some routers you can replace it with a free one (like OpenWrt) that offers more control.',
  },
  controladora: {
    term: 'Controller',
    short: 'A central program or box that manages all the access points and gear from one brand (UniFi, Omada).',
    long: 'In systems like Ubiquiti UniFi or TP-Link Omada, you do not configure each antenna separately: you talk to a central controller that coordinates them. KrakenOS connects to that controller, not to each device.',
  },
  'certificado-autofirmado': {
    term: 'Self-signed certificate',
    short: 'A security certificate a device creates for itself, valid inside your home even though the browser warns about it.',
    long: 'Many local devices (routers, bridges, controllers) use HTTPS with a certificate they sign themselves. The browser distrusts it because it does not come from a known authority, but on your own local network it is normal and safe to accept it.',
  },
  mqtt: {
    term: 'MQTT / broker',
    short: 'A lightweight “mail carrier” system that delivers messages between smart gadgets. The broker is the central post office.',
    long: 'Some devices (Zigbee via zigbee2mqtt, Meross) do not talk directly to KrakenOS: they drop off and pick up messages at an MQTT broker (like Mosquitto). KrakenOS connects to that broker to learn everything and send commands.',
  },
  'application-key': {
    term: 'Application key',
    short: 'A key a device (like the Hue bridge) hands you the first time so an app can control it.',
    long: 'For KrakenOS to control your Hue lights, the bridge has to grant it permission once. You press the physical button on the bridge and it generates this key, which is then saved so you do not have to repeat the permission.',
  },
};
