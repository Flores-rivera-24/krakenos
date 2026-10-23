# Activar DNS con Pi-hole (API REST v6)

`DNS_KIND=pihole` hace que la página **DNS** de KrakenOS administre un **Pi-hole v6** existente
por su API REST (`apps/agent/src/dns/pihole.dns.ts`). No necesita el helper privilegiado: es HTTP.

Qué cubre:

| Función | Endpoint de Pi-hole |
|---|---|
| Autenticación (SID de sesión, renovado ante 401) | `POST /api/auth` → cabecera `X-FTL-SID` |
| Estadísticas (consultas, bloqueadas, tamaño de la blocklist) | `GET /api/stats/summary` |
| Dominios bloqueados a mano | `GET/POST/DELETE /api/domains/deny/exact` |
| Últimas consultas | `GET /api/queries` |
| Listas por categoría (publicidad, malware, rastreo…) | `GET/POST/DELETE /api/lists?type=block` |

> **Solo Pi-hole v6.** La v5 tenía otra API (`admin/api.php`) y no es compatible.

---

## 1. Requisitos

- Pi-hole **v6** instalado (en el mismo servidor o en otro de la LAN).
- **Que tus equipos lo usen como DNS.** KrakenOS **no** cambia el DNS de tu red: configura en el
  DHCP del router el DNS = IP del Pi-hole (o deja que Pi-hole haga de DHCP). Sin esto, el bloqueo
  no afecta a nadie aunque la página DNS muestre datos.

## 2. Contraseña

KrakenOS se autentica con la contraseña de la interfaz web de Pi-hole. Mejor aún, crea una
**contraseña de aplicación** en *Settings → Web interface / API → Configure app password* y usa
esa: se puede revocar sin cambiar la tuya. Si tu Pi-hole no tiene contraseña, déjala vacía.

## 3. Configurar

**Desde la app:** Conectar → DNS → Pi-hole. **Por `.env`:**

```env
DNS_KIND=pihole
PIHOLE_URL=http://192.168.1.53      # o http://pi.hole
PIHOLE_PASSWORD=la-app-password
```

## 4. Probar

1. En `/dns` deben salir las estadísticas del día y las últimas consultas.
2. Bloquea un dominio a mano → aparece en Pi-hole en *Domains* como *exact deny*.
3. Activa una lista por categoría → aparece en *Lists*.

## Limitaciones conocidas

- Una lista nueva **no bloquea hasta que Pi-hole recompila gravity** (su actualización periódica,
  o `pihole -g` / *Tools → Update Gravity*).
- Solo se gestionan dominios **exactos** de bloqueo; los regex y las listas de permitidos se
  siguen administrando en Pi-hole.
- Si `PIHOLE_URL` apunta fuera de la LAN, se aplica la política de egress del agente
  (`safeFetch`).
