# Activar Philips Hue (CLIP API v2 local)

El `HueIotManager` ya existe (US-28): habla con el **bridge Hue** por su **CLIP API v2 local**
(sin nube). Solo hace falta encontrar la IP del bridge, generar una *application key* y
configurar el `.env`.

---

## 1. Encontrar la IP del bridge

Cualquiera de estas opciones:

- Mira en tu router (o en `/inventory` de KrakenOS) el dispositivo cuyo fabricante es
  **Philips / Signify**.
- Desde la LAN, consulta el servicio de discovery de Philips:

  ```bash
  curl -s https://discovery.meethue.com/
  # → [{"id":"...","internalipaddress":"192.168.1.50","port":443}]
  ```

  Usa el `internalipaddress` como IP del bridge.

## 2. Generar la application key

La CLIP API v2 exige una *application key* (equivale a `HUE_APP_KEY`). Se obtiene haciendo un
`POST` **mientras se pulsa el botón físico (link button) del bridge**:

1. **Pulsa el botón redondo** del bridge (tienes ~30 s tras pulsarlo).
2. Inmediatamente lanza:

   ```bash
   curl -sk -X POST https://192.168.1.50/api \
     -H 'Content-Type: application/json' \
     -d '{"devicetype":"krakenos#agent","generateclientkey":true}'
   ```

   - `-k` ignora el certificado autofirmado del bridge (es local).
   - Respuesta esperada:

     ```json
     [{"success":{"username":"AbCdEf...laAppKey...","clientkey":"..."}}]
     ```

   - Si ves `[{"error":{"type":101,...}}]`, **no pulsaste el botón a tiempo**: repite.
3. Copia el valor de `username` → ese es tu `HUE_APP_KEY`.

## 3. Configurar el `.env`

```env
# IoT — Philips Hue (CLIP API v2 local, sin internet)
IOT_KIND=hue
HUE_BRIDGE_URL=https://192.168.1.50   # IP del bridge Hue (con https://)
HUE_APP_KEY=AbCdEf...laAppKey...
```

## 4. Certificado autofirmado del bridge

El bridge sirve HTTPS con un **certificado autofirmado** (es una IP de tu red: no puede tener
uno público). **No tienes que hacer nada**: desde US-259 KrakenOS lo gestiona solo.

> **Ya no hace falta `NODE_TLS_REJECT_UNAUTHORIZED=0`. Si lo tienes puesto, quítalo.** Esa
> variable desactivaba la validación TLS de **todo** el proceso Node —no solo del bridge—, así
> que con ella puesta tampoco se verificaba a quién hablaban los avisos de Telegram, la
> comprobación de actualizaciones ni el Web Push. Un aparato de tu casa acababa bajando la
> guardia de todo lo demás.
>
> **Qué hace ahora en su lugar:** la excepción se aplica **solo a la conexión con el bridge**, y
> únicamente si la dirección configurada resuelve a una IP privada de tu red. Si `HUE_BRIDGE_URL`
> apuntara a un host de internet, el certificado se verifica con normalidad.
>
> ⚠️ **Lo que sigue sin cubrirse, dicho claro:** dentro de tu LAN el bridge no queda
> *autenticado*. Quien pueda suplantar su IP en tu red podría hacerse pasar por él. Cerrar eso
> exige fijar el certificado del bridge la primera vez que se empareja, y está pendiente. Lo que
> se ha ganado es el radio del problema: antes era «todo lo que hace el servidor», ahora es «esta
> conexión a esta IP de mi red».

## 5. Probar

```bash
pnpm dev
```

- Ve a **`/iot`**: deben aparecer tus focos Hue.
- Prueba **on/off**, **brillo** y **color** (el contrato IoT incluye color desde US-28).

Si no aparecen: confirma la IP del bridge, que la `HUE_APP_KEY` es correcta y que el
*workaround* TLS está activo. Los errores de conexión salen en los logs del agente.
