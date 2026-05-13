const WS_URL = 'ws://localhost:3001'
const RECONNECT_MS = 3000

export class LiveClient {
  // callbacks:
  //   onArrival(ev)        — backward compat STOPPED_AT event
  //   onVehicleUpdate(ev)  — full vehicle state update
  //   onTripUpdate(ev)     — delay / schedule relationship update
  //   onAlertUpdate(alerts)— service alert list
  //   onStatus(str)        — 'connected' | 'disconnected' | 'error'
  constructor({ onArrival, onVehicleUpdate, onTripUpdate, onAlertUpdate, onStatus }) {
    this.onArrival       = onArrival       ?? (() => {})
    this.onVehicleUpdate = onVehicleUpdate ?? (() => {})
    this.onTripUpdate    = onTripUpdate    ?? (() => {})
    this.onAlertUpdate   = onAlertUpdate   ?? (() => {})
    this.onStatus        = onStatus        ?? (() => {})
    this.ws     = null
    this._timer = null
    this._active = false
  }

  connect() {
    this._active = true
    this._open()
  }

  disconnect() {
    this._active = false
    clearTimeout(this._timer)
    this.ws?.close()
    this.ws = null
  }

  _open() {
    if (!this._active) return
    this.ws = new WebSocket(WS_URL)

    this.ws.onopen = () => {
      clearTimeout(this._timer)
      this.onStatus('connected')
    }

    this.ws.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }

      switch (msg.type) {
        case 'arrival':        this.onArrival(msg);       break
        case 'vehicle_update': this.onVehicleUpdate(msg); break
        case 'trip_update':    this.onTripUpdate(msg);    break
        case 'alert_update':   this.onAlertUpdate(msg.alerts ?? []); break
      }
    }

    this.ws.onclose = () => {
      this.onStatus('disconnected')
      if (this._active) {
        this._timer = setTimeout(() => this._open(), RECONNECT_MS)
      }
    }

    this.ws.onerror = () => {
      this.onStatus('error')
    }
  }
}
