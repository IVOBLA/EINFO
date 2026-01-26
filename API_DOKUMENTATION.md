# EINFO - API & Konfigurations-Dokumentation

## Inhaltsverzeichnis

1. [Systemübersicht](#systemübersicht)
2. [Haupt-Server API (Port 4040)](#haupt-server-api-port-4040)
   - [Authentifizierung & Benutzerverwaltung](#authentifizierung--benutzerverwaltung)
   - [Einsatz-Board (Incident Management)](#einsatz-board-incident-management)
   - [Fahrzeugverwaltung](#fahrzeugverwaltung)
   - [Gruppen & Geografische Daten](#gruppen--geografische-daten)
   - [Protokoll/Lageberichte](#protokolllageberichte)
   - [Aufgaben/Zuweisungen](#aufgabenzuweisungen)
   - [Mail & Benachrichtigungen](#mail--benachrichtigungen)
   - [Drucken & PDF-Export](#drucken--pdf-export)
   - [Import & Auto-Funktionen](#import--auto-funktionen)
   - [Feuerwehr-Feed (Fetcher)](#feuerwehr-feed-fetcher)
   - [Aktivität & Status](#aktivität--status)
3. [Chatbot-Server API (Port 3001)](#chatbot-server-api-port-3001)
   - [Szenarien](#szenarien)
   - [Simulations-Steuerung](#simulations-steuerung)
   - [Chat & LLM-Interaktion](#chat--llm-interaktion)
   - [Audit Trail (Übungsprotokollierung)](#audit-trail-übungsprotokollierung)
   - [Templates (Übungsvorlagen)](#templates-übungsvorlagen)
   - [Katastrophen-Kontext](#katastrophen-kontext)
   - [Feedback & Lernen](#feedback--lernen)
   - [Administration](#administration)
4. [Konfigurationsvariablen](#konfigurationsvariablen)
   - [Server-Konfiguration](#server-konfiguration)
   - [UI-Polling](#ui-polling)
   - [Feuerwehr-Feed](#feuerwehr-feed)
   - [Auto-Import & Auto-Print](#auto-import--auto-print)
   - [WMS/Kartendienst](#wmskartendienst)
   - [Druckverzeichnisse](#druckverzeichnisse)
   - [Benutzersitzungen](#benutzersitzungen)
   - [Aufgaben](#aufgaben)
   - [Mail/SMTP](#mailsmtp)
   - [Chatbot LLM](#chatbot-llm)
   - [RAG & Embeddings](#rag--embeddings)
   - [Simulation](#simulation)
   - [GPU/Ollama](#gpuollama)
5. [Dateibasierte Konfigurationen](#dateibasierte-konfigurationen)
6. [Fehlerbehandlung & Statuscodes](#fehlerbehandlung--statuscodes)
7. [Authentifizierung](#authentifizierung)
8. [Beispiele](#beispiele)

---

## Systemübersicht

EINFO ist ein deutschsprachiges Einsatzleitsystem mit Katastrophensimulation, bestehend aus zwei Hauptkomponenten:

- **Haupt-Server** (Port 4040): Express.js-Backend für Einsatzverwaltung, Fahrzeuge, Protokolle und Aufgaben
- **Chatbot-Server** (Port 3001): Separate Express.js-Instanz für KI-gestützte Katastrophensimulationen

### Technologie-Stack
- **Framework**: Express.js (beide Server)
- **Datenaustausch**: JSON-basierte REST-APIs (max. 10MB)
- **Authentifizierung**: Session-basiert mit Cookies
- **LLM**: Ollama-Integration für KI-Funktionen
- **Architektur**: Monorepo-Struktur mit modularen Route-Handlern

---

## Haupt-Server API (Port 4040)

### Authentifizierung & Benutzerverwaltung

Basis-URL: `/api/user`

#### POST `/api/user/master/setup`
Initialisiert Master-Passwort und Admin-Benutzer beim ersten Start.

**Request Body:**
```json
{
  "masterPassword": "string",
  "adminUsername": "string",
  "adminPassword": "string"
}
```

**Response:**
```json
{
  "ok": true,
  "user": {
    "id": "string",
    "username": "string",
    "role": "string"
  }
}
```

#### POST `/api/user/master/unlock`
Entsperrt das System mit dem Master-Passwort.

**Request Body:**
```json
{
  "masterPassword": "string"
}
```

#### POST `/api/user/master/lock`
Sperrt das System (alle Benutzer werden ausgeloggt).

**Response:**
```json
{
  "ok": true
}
```

#### POST `/api/user/login`
Benutzer-Login mit Zugangsdaten.

**Request Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "ok": true,
  "user": {
    "id": "string",
    "username": "string",
    "role": "string",
    "roleAlias": "string"
  }
}
```

#### GET `/api/user/me`
Gibt den aktuell eingeloggten Benutzer und Sitzungsinformationen zurück.

**Response:**
```json
{
  "ok": true,
  "user": {
    "id": "string",
    "username": "string",
    "role": "string",
    "roleAlias": "string"
  },
  "session": {
    "id": "string",
    "lastActivity": "ISO-8601 timestamp"
  }
}
```

#### POST `/api/user/logout`
Logout und Zerstörung der Sitzung.

**Response:**
```json
{
  "ok": true
}
```

#### GET `/api/user/online-roles`
Liste aller aktuell aktiven Rollen.

**Response:**
```json
{
  "ok": true,
  "roles": [
    {
      "role": "string",
      "username": "string",
      "lastActivity": "ISO-8601 timestamp",
      "isActive": true
    }
  ]
}
```

#### GET `/api/user/roles`
Gibt alle definierten Rollen zurück.

**Response:**
```json
{
  "ok": true,
  "roles": [
    {
      "id": "string",
      "name": "string",
      "permissions": ["string"]
    }
  ]
}
```

#### PUT `/api/user/roles`
Aktualisiert Rollendefinitionen.

**Request Body:**
```json
{
  "roles": [
    {
      "id": "string",
      "name": "string",
      "permissions": ["string"]
    }
  ]
}
```

#### GET `/api/user/users`
Liste aller Benutzer (nur für Admins).

**Response:**
```json
{
  "ok": true,
  "users": [
    {
      "id": "string",
      "username": "string",
      "role": "string",
      "created": "ISO-8601 timestamp"
    }
  ]
}
```

#### POST `/api/user/users`
Erstellt einen neuen Benutzer.

**Request Body:**
```json
{
  "username": "string",
  "password": "string",
  "role": "string"
}
```

#### PATCH `/api/user/users/:id`
Ändert Benutzerdaten.

**Request Body:**
```json
{
  "username": "string",
  "password": "string",
  "role": "string"
}
```

#### DELETE `/api/user/users/:id`
Löscht einen Benutzer.

**Response:**
```json
{
  "ok": true
}
```

#### GET `/api/user/fetcher`
Gibt globale Fetcher-Zugangsdaten zurück.

**Response:**
```json
{
  "ok": true,
  "username": "string",
  "password": "string"
}
```

#### PUT `/api/user/fetcher`
Aktualisiert Fetcher-Zugangsdaten.

**Request Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

---

### Einsatz-Board (Incident Management)

#### GET `/api/board`
Gibt das komplette Einsatz-Board mit allen Karten und Spalten zurück.

**Response:**
```json
{
  "ok": true,
  "board": {
    "columns": [
      {
        "id": "string",
        "name": "string",
        "cards": [
          {
            "id": "string",
            "title": "string",
            "description": "string",
            "priority": "number",
            "assignedVehicles": ["string"],
            "personnel": {
              "count": "number",
              "details": "string"
            },
            "created": "ISO-8601 timestamp",
            "updated": "ISO-8601 timestamp"
          }
        ]
      }
    ]
  }
}
```

#### POST `/api/cards`
Erstellt eine neue Einsatzkarte.

**Request Body:**
```json
{
  "title": "string",
  "description": "string",
  "priority": 1,
  "columnId": "string"
}
```

**Response:**
```json
{
  "ok": true,
  "card": {
    "id": "string",
    "title": "string",
    "description": "string",
    "priority": 1,
    "created": "ISO-8601 timestamp"
  }
}
```

#### POST `/api/cards/:id/move`
Verschiebt eine Karte zwischen Spalten.

**Request Body:**
```json
{
  "targetColumnId": "string",
  "position": 0
}
```

#### POST `/api/cards/:id/assign`
Weist Fahrzeuge einer Karte zu.

**Request Body:**
```json
{
  "vehicleIds": ["string"]
}
```

#### POST `/api/cards/:id/unassign`
Entfernt Fahrzeugzuweisungen von einer Karte.

**Request Body:**
```json
{
  "vehicleIds": ["string"]
}
```

#### PATCH `/api/cards/:id`
Aktualisiert Karteneigenschaften.

**Request Body:**
```json
{
  "title": "string",
  "description": "string",
  "priority": 1
}
```

#### PATCH `/api/cards/:id/personnel`
Aktualisiert Personalinformationen auf einer Karte.

**Request Body:**
```json
{
  "count": 5,
  "details": "3 Atemschutzträger, 2 Maschinisten"
}
```

#### POST `/api/reset`
Setzt das gesamte Board auf den Anfangszustand zurück.

**Response:**
```json
{
  "ok": true,
  "message": "Board reset successfully"
}
```

---

### Fahrzeugverwaltung

#### GET `/api/vehicles`
Gibt alle Fahrzeuge mit aktuellen Überschreibungen zurück.

**Response:**
```json
{
  "ok": true,
  "vehicles": [
    {
      "id": "string",
      "name": "string",
      "type": "string",
      "group": "string",
      "available": true,
      "position": {
        "lat": 46.1234,
        "lng": 14.5678,
        "timestamp": "ISO-8601 timestamp"
      },
      "availability": {
        "status": "verfügbar|abwesend|im_einsatz",
        "until": "ISO-8601 timestamp",
        "reason": "string"
      }
    }
  ]
}
```

#### POST `/api/vehicles`
Fügt ein neues Fahrzeug hinzu (unterstützt Klonen).

**Request Body:**
```json
{
  "name": "string",
  "type": "string",
  "group": "string",
  "cloneFrom": "optional vehicle id"
}
```

#### PATCH `/api/vehicles/:id/availability`
Setzt die Fahrzeugverfügbarkeit/Abwesenheit.

**Request Body:**
```json
{
  "status": "verfügbar|abwesend|im_einsatz",
  "until": "ISO-8601 timestamp",
  "reason": "Wartung, Schulung, etc."
}
```

#### PATCH `/api/vehicles/:id/position`
Aktualisiert die Fahrzeug-GPS-Position.

**Request Body:**
```json
{
  "lat": 46.1234,
  "lng": 14.5678
}
```

#### DELETE `/api/vehicles/:id/position`
Löscht die gespeicherte Position eines Fahrzeugs.

**Response:**
```json
{
  "ok": true
}
```

#### GET `/api/nearby`
Sucht Fahrzeuge in der Nähe.

**Query-Parameter:**
- `lat`: Breitengrad (erforderlich)
- `lng`: Längengrad (erforderlich)
- `radiusKm`: Suchradius in Kilometern (Standard: aus `NEARBY_RADIUS_KM`)

**Beispiel:**
```
GET /api/nearby?lat=46.7167&lng=14.1833&radiusKm=5
```

**Response:**
```json
{
  "ok": true,
  "vehicles": [
    {
      "id": "string",
      "name": "string",
      "distance": 2.5,
      "position": {
        "lat": 46.1234,
        "lng": 14.5678
      }
    }
  ],
  "searchCenter": {
    "lat": 46.7167,
    "lng": 14.1833
  },
  "radiusKm": 5
}
```

---

### Gruppen & Geografische Daten

#### GET `/api/groups/availability`
Gibt den Verfügbarkeitsstatus aller Gruppen zurück.

**Response:**
```json
{
  "ok": true,
  "groups": [
    {
      "name": "string",
      "availableCount": 5,
      "totalCount": 8,
      "percentage": 62.5
    }
  ]
}
```

#### GET `/api/groups/alerted`
Gibt den Alarmierungsstatus der Gruppen zurück.

**Response:**
```json
{
  "ok": true,
  "groups": [
    {
      "name": "string",
      "alerted": true,
      "timestamp": "ISO-8601 timestamp"
    }
  ]
}
```

#### PATCH `/api/groups/:name/availability`
Setzt die gruppenweite Verfügbarkeit.

**Request Body:**
```json
{
  "status": "verfügbar|abwesend",
  "until": "ISO-8601 timestamp",
  "reason": "string"
}
```

#### GET `/api/gps`
Gibt rohe GPS-Daten aller Fahrzeuge zurück.

**Response:**
```json
{
  "ok": true,
  "vehicles": [
    {
      "id": "string",
      "lat": 46.1234,
      "lng": 14.5678,
      "timestamp": "ISO-8601 timestamp"
    }
  ]
}
```

#### GET `/api/types`
Gibt alle Fahrzeugtyp-Definitionen zurück.

**Response:**
```json
{
  "ok": true,
  "types": [
    {
      "id": "string",
      "name": "string",
      "category": "string",
      "icon": "string"
    }
  ]
}
```

#### GET `/api/internal/feldkirchen-map`
Generiert eine SVG-Karte.

**Query-Parameter:**
- `show`: `weather|all` (Standard: `all`)
- `hours`: Zeitraum in Stunden (Standard: 24)

**Beispiel:**
```
GET /api/internal/feldkirchen-map?show=weather&hours=12
```

**Response:**
```xml
<svg>...</svg>
```

#### DELETE `/api/internal/feldkirchen-map`
Löscht den gecachten SVG-Karten-Cache.

---

### Protokoll/Lageberichte

Basis-URL: `/api/protocol`

Quelle: `server/routes/protocol.js`

#### GET `/api/protocol/csv/file`
Lädt das Protokoll als CSV-Datei herunter.

**Response:**
```
Content-Type: text/csv
Content-Disposition: attachment; filename="protokoll.csv"

Nr;Datum;Zeit;Benutzer;Inhalt
1;2026-01-05;14:30;S1;Einsatzbeginn...
```

#### GET `/api/protocol`
Listet alle Protokolleinträge auf.

**Response:**
```json
{
  "ok": true,
  "entries": [
    {
      "nr": 1,
      "timestamp": "ISO-8601 timestamp",
      "user": "string",
      "role": "string",
      "content": "string",
      "locked": false,
      "lockedBy": null
    }
  ]
}
```

#### GET `/api/protocol/:nr`
Gibt einen einzelnen Protokolleintrag zurück.

**Response:**
```json
{
  "ok": true,
  "entry": {
    "nr": 1,
    "timestamp": "ISO-8601 timestamp",
    "user": "string",
    "role": "string",
    "content": "string",
    "history": [
      {
        "timestamp": "ISO-8601 timestamp",
        "user": "string",
        "content": "string"
      }
    ]
  }
}
```

#### POST `/api/protocol`
Erstellt einen neuen Protokolleintrag.

**Request Body:**
```json
{
  "content": "string"
}
```

**Response:**
```json
{
  "ok": true,
  "entry": {
    "nr": 1,
    "timestamp": "ISO-8601 timestamp",
    "user": "string",
    "role": "string",
    "content": "string"
  }
}
```

#### PUT `/api/protocol/:nr`
Aktualisiert einen Protokolleintrag (mit Versionierung).

**Request Body:**
```json
{
  "content": "string"
}
```

**Response:**
```json
{
  "ok": true,
  "entry": {
    "nr": 1,
    "timestamp": "ISO-8601 timestamp",
    "user": "string",
    "content": "string",
    "history": [...]
  }
}
```

#### POST `/api/protocol/:nr/lock`
Sperrt einen Protokolleintrag für die Bearbeitung.

**Response:**
```json
{
  "ok": true,
  "lockedBy": "string",
  "lockedAt": "ISO-8601 timestamp"
}
```

#### DELETE `/api/protocol/:nr/lock`
Entsperrt einen Protokolleintrag.

**Response:**
```json
{
  "ok": true
}
```

---

### Aufgaben/Zuweisungen

Basis-URL: `/api/aufgaben`

Quelle: `server/routes/aufgabenRoutes.js` (alle Routen erfordern Authentifizierung)

#### GET `/api/aufgaben/config`
Gibt den Standard-Fälligkeitsversatz für die aktuelle Rolle zurück.

**Response:**
```json
{
  "ok": true,
  "defaultDueOffsetMinutes": 10
}
```

#### GET `/api/aufgaben/protocols`
Gibt Protokoll-Auszüge für die aktuelle Rolle zurück.

**Response:**
```json
{
  "ok": true,
  "protocols": [
    {
      "nr": 1,
      "timestamp": "ISO-8601 timestamp",
      "content": "string",
      "excerpt": "string"
    }
  ]
}
```

#### GET `/api/aufgaben`
Listet Aufgaben für den aktuellen Benutzer/Rolle auf.

**Response:**
```json
{
  "ok": true,
  "aufgaben": [
    {
      "id": "string",
      "title": "string",
      "description": "string",
      "status": "offen|in_bearbeitung|erledigt",
      "priority": 1,
      "assignedTo": "string",
      "assignedRole": "string",
      "dueDate": "ISO-8601 timestamp",
      "linkedProtocols": [1, 2, 3],
      "created": "ISO-8601 timestamp",
      "updated": "ISO-8601 timestamp"
    }
  ]
}
```

#### POST `/api/aufgaben`
Erstellt eine neue Aufgabe.

**Request Body:**
```json
{
  "title": "string",
  "description": "string",
  "priority": 1,
  "assignedRole": "string",
  "dueOffsetMinutes": 10,
  "linkedProtocols": [1, 2]
}
```

#### POST `/api/aufgaben/:id/edit`
Bearbeitet eine Aufgabe und verknüpft sie mit Protokollen.

**Request Body:**
```json
{
  "title": "string",
  "description": "string",
  "priority": 1,
  "dueOffsetMinutes": 15,
  "linkedProtocols": [1, 2, 3]
}
```

#### POST `/api/aufgaben/:id/status`
Ändert den Status einer Aufgabe.

**Request Body:**
```json
{
  "status": "offen|in_bearbeitung|erledigt"
}
```

#### POST `/api/aufgaben/reorder`
Aktualisiert die Reihenfolge der Aufgaben.

**Request Body:**
```json
{
  "aufgabenIds": ["id1", "id2", "id3"]
}
```

---

### Mail & Benachrichtigungen

Basis-URL: `/api/mail`

Quellen: `server/routes/mail.js` und `server/routes/mailInbox.js`

#### GET `/api/mail/status`
Prüft die SMTP-Konfiguration.

**Response:**
```json
{
  "ok": true,
  "configured": true,
  "host": "smtp.example.com",
  "port": 587,
  "secure": false,
  "user": "user@example.com"
}
```

#### POST `/api/mail/send`
Sendet eine E-Mail.

**Request Body:**
```json
{
  "to": "recipient@example.com",
  "cc": "cc@example.com",
  "bcc": "bcc@example.com",
  "subject": "string",
  "text": "Plaintext content",
  "html": "<p>HTML content</p>",
  "from": "sender@example.com",
  "replyTo": "reply@example.com",
  "headers": {
    "X-Custom-Header": "value"
  }
}
```

**Response:**
```json
{
  "ok": true,
  "messageId": "string",
  "accepted": ["recipient@example.com"],
  "rejected": []
}
```

#### GET `/api/mail/inbox/status`
Gibt den Status der Posteingang-Überwachung zurück.

**Response:**
```json
{
  "ok": true,
  "polling": true,
  "lastCheck": "ISO-8601 timestamp",
  "messageCount": 5
}
```

#### GET `/api/mail/inbox`
Gibt verarbeitete Posteingang-Nachrichten zurück.

**Response:**
```json
{
  "ok": true,
  "messages": [
    {
      "id": "string",
      "from": "sender@example.com",
      "subject": "string",
      "date": "ISO-8601 timestamp",
      "body": "string",
      "processed": true
    }
  ]
}
```

#### Mail-Scheduling (Geplante E-Mails)

Basis-URL: `/api/mail/schedule`

#### GET `/api/mail/schedule`
Listet geplante Mail-Tasks auf.

**Response:**
```json
{
  "ok": true,
  "schedules": [
    {
      "id": "string",
      "name": "string",
      "enabled": true,
      "intervalMinutes": 60,
      "to": "recipient@example.com",
      "subject": "string",
      "template": "string",
      "lastRun": "ISO-8601 timestamp",
      "nextRun": "ISO-8601 timestamp"
    }
  ]
}
```

#### POST `/api/mail/schedule`
Erstellt eine geplante E-Mail.

**Request Body:**
```json
{
  "name": "string",
  "enabled": true,
  "intervalMinutes": 60,
  "to": "recipient@example.com",
  "subject": "string",
  "template": "string"
}
```

#### PUT `/api/mail/schedule/:id`
Aktualisiert eine geplante E-Mail.

**Request Body:**
```json
{
  "name": "string",
  "enabled": false,
  "intervalMinutes": 30
}
```

#### DELETE `/api/mail/schedule/:id`
Löscht eine geplante E-Mail.

---

### HTTP-Webhook-Scheduling

Basis-URL: `/api/http/schedule`

#### GET `/api/http/schedule`
Listet geplante HTTP-Aufrufe auf.

**Response:**
```json
{
  "ok": true,
  "schedules": [
    {
      "id": "string",
      "name": "string",
      "enabled": true,
      "intervalMinutes": 60,
      "url": "https://example.com/webhook",
      "method": "POST",
      "headers": {
        "Content-Type": "application/json"
      },
      "body": "string",
      "lastRun": "ISO-8601 timestamp",
      "nextRun": "ISO-8601 timestamp"
    }
  ]
}
```

#### POST `/api/http/schedule`
Erstellt einen geplanten HTTP-Webhook.

**Request Body:**
```json
{
  "name": "string",
  "enabled": true,
  "intervalMinutes": 60,
  "url": "https://example.com/webhook",
  "method": "POST|GET|PUT|DELETE",
  "headers": {
    "Authorization": "Bearer token"
  },
  "body": "{\"key\": \"value\"}"
}
```

#### PUT `/api/http/schedule/:id`
Aktualisiert einen Webhook-Schedule.

#### DELETE `/api/http/schedule/:id`
Löscht einen Webhook-Schedule.

---

### Drucken & PDF-Export

Quellen: `server/routes/incidentPrintRoutes.js` und `server/routes/serverPrintRoutes.js`

#### POST `/api/incidents/:incidentId/print`
Rendert ein Einsatz-PDF.

**Request Body:**
```json
{
  "template": "default|detailed",
  "options": {
    "includeMap": true,
    "includeVehicles": true
  }
}
```

**Response:**
```json
{
  "ok": true,
  "pdfPath": "/path/to/pdf",
  "pdfUrl": "/downloads/incident_123.pdf"
}
```

#### POST `/api/print/server`
Stellt einen serverseitigen Druckauftrag in die Warteschlange.

**Request Body:**
```json
{
  "type": "protokoll|einsatz|meldung",
  "data": {
    "content": "string"
  }
}
```

#### GET `/api/print/server/info`
Gibt den Status der Druckwarteschlange zurück.

**Response:**
```json
{
  "ok": true,
  "queue": [
    {
      "id": "string",
      "type": "protokoll",
      "status": "pending|printing|completed|failed",
      "created": "ISO-8601 timestamp"
    }
  ]
}
```

#### GET `/api/export/pdf`
Exportiert das gesamte Board als PDF.

**Response:**
```
Content-Type: application/pdf
Content-Disposition: attachment; filename="board.pdf"

[PDF Binary Data]
```

---

### Import & Auto-Funktionen

#### GET `/api/import/auto-config`
Gibt die Auto-Import-Einstellungen zurück.

**Response:**
```json
{
  "ok": true,
  "config": {
    "enabled": true,
    "intervalSeconds": 30,
    "source": "string",
    "lastRun": "ISO-8601 timestamp"
  }
}
```

#### POST `/api/import/auto-config`
Aktualisiert die Auto-Import-Konfiguration.

**Request Body:**
```json
{
  "enabled": true,
  "intervalSeconds": 30,
  "source": "string"
}
```

#### POST `/api/import/trigger`
Löst einen einzelnen Import manuell aus.

**Response:**
```json
{
  "ok": true,
  "imported": 5,
  "skipped": 2,
  "errors": []
}
```

#### GET `/api/import/trigger`
Alternative GET-Route für manuellen Import-Trigger.

#### GET `/api/protocol/auto-print-config`
Gibt die Auto-Druck-Einstellungen zurück.

**Response:**
```json
{
  "ok": true,
  "config": {
    "enabled": true,
    "intervalMinutes": 10,
    "lastRun": "ISO-8601 timestamp"
  }
}
```

#### POST `/api/protocol/auto-print-config`
Aktualisiert die Auto-Druck-Konfiguration.

**Request Body:**
```json
{
  "enabled": true,
  "intervalMinutes": 10
}
```

---

### Feuerwehr-Feed (Fetcher)

Basis-URL: `/api/ff` (Feuerwehr-Feed)

#### GET `/api/ff/status`
Status des Fetchers mit Auto-Import-Flag.

**Response:**
```json
{
  "ok": true,
  "running": true,
  "autoImport": true,
  "lastUpdate": "ISO-8601 timestamp",
  "itemCount": 15
}
```

#### GET `/api/ff/creds`
Gibt die Fetcher-Zugangsdaten zurück.

**Response:**
```json
{
  "ok": true,
  "username": "string",
  "password": "***"
}
```

#### POST `/api/ff/creds`
Aktualisiert Fetcher-Zugangsdaten.

**Request Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

#### GET `/api/ff/status/details`
Detaillierter Fetcher-Status.

**Response:**
```json
{
  "ok": true,
  "running": true,
  "autoImport": true,
  "lastUpdate": "ISO-8601 timestamp",
  "nextUpdate": "ISO-8601 timestamp",
  "itemCount": 15,
  "errors": [],
  "config": {
    "pollIntervalMs": 60000,
    "timeout": 2880
  }
}
```

#### POST `/api/ff/start`
Startet den Fetcher.

**Request Body (optional):**
```json
{
  "auto": true
}
```

**Response:**
```json
{
  "ok": true,
  "running": true,
  "autoImport": true
}
```

#### POST `/api/ff/stop`
Stoppt den Fetcher.

**Response:**
```json
{
  "ok": true,
  "running": false
}
```

---

### Aktivität & Status

#### GET `/api/activity/status`
Öffentlicher Status (keine Authentifizierung erforderlich).

**Response:**
```json
{
  "ok": true,
  "activeIncidents": 3,
  "availableVehicles": 12,
  "totalVehicles": 15,
  "onlineUsers": 4,
  "lastUpdate": "ISO-8601 timestamp"
}
```

#### GET `/api/log.csv`
Log-Datei als CSV.

**Response:**
```
Content-Type: text/csv

timestamp,level,message
2026-01-05T14:30:00Z,info,Server started
```

---

### Statische Dateien

#### GET `/Hilfe.pdf`
Hilfedokumentation als PDF.

#### GET `/status`
SPA-Landing-Page (dient `dist/index.html`).

---

## Chatbot-Server API (Port 3001)

Quelle: `/home/user/EINFO/chatbot/server/index.js` (1.158 Zeilen)

Standard-Port: **3001**

### Szenarien

#### GET `/api/scenarios`
Listet alle verfügbaren Szenarien auf.

**Response:**
```json
{
  "ok": true,
  "scenarios": [
    {
      "id": "hochwasser_feldkirchen",
      "name": "Hochwasser Feldkirchen",
      "description": "string",
      "difficulty": "medium",
      "duration": "2-3 hours"
    }
  ]
}
```

#### GET `/api/scenarios/:scenarioId`
Lädt ein spezifisches Szenario.

**Response:**
```json
{
  "ok": true,
  "scenario": {
    "id": "string",
    "name": "string",
    "description": "string",
    "initialState": {},
    "events": [],
    "objectives": []
  }
}
```

---

### Simulations-Steuerung

#### POST `/api/sim/start`
Startet eine Simulation mit einem Szenario.

**Request Body:**
```json
{
  "scenarioId": "hochwasser_feldkirchen",
  "options": {
    "autoStep": true,
    "stepIntervalMs": 120000
  }
}
```

**Response:**
```json
{
  "ok": true,
  "simulationId": "string",
  "scenario": "hochwasser_feldkirchen",
  "startTime": "ISO-8601 timestamp"
}
```

#### GET `/api/sim/scenario`
Gibt das aktive Simulationsszenario zurück.

**Response:**
```json
{
  "ok": true,
  "simulationId": "string",
  "scenario": {
    "id": "string",
    "name": "string",
    "currentPhase": "string",
    "elapsedTime": 1800
  }
}
```

#### POST `/api/sim/pause`
Pausiert die laufende Simulation.

**Response:**
```json
{
  "ok": true,
  "paused": true
}
```

#### POST `/api/sim/step`
Führt einen einzelnen Simulationsschritt aus.

**Response:**
```json
{
  "ok": true,
  "step": 5,
  "events": [
    {
      "type": "string",
      "description": "string",
      "timestamp": "ISO-8601 timestamp"
    }
  ]
}
```

---

### Chat & LLM-Interaktion

#### POST `/api/chat`
Sendet eine Chat-Nachricht mit Streaming-Antwort.

**Rate Limit**: GENEROUS

**Request Body:**
```json
{
  "message": "string",
  "context": {
    "role": "S1",
    "simulationId": "string"
  }
}
```

**Response (Streaming):**
```
Content-Type: text/event-stream

data: {"chunk": "Ich verstehe..."}
data: {"chunk": " die Situation."}
data: {"done": true}
```

#### GET `/api/llm/models`
Listet verfügbare LLM-Modelle auf.

**Response:**
```json
{
  "ok": true,
  "models": [
    {
      "key": "llama3.1:8b",
      "name": "Llama 3.1 8B",
      "size": "8B",
      "available": true
    }
  ]
}
```

#### GET `/api/llm/gpu`
GPU-Status und Speicherinformationen.

**Response:**
```json
{
  "ok": true,
  "gpu": {
    "available": true,
    "count": 1,
    "devices": [
      {
        "id": 0,
        "name": "NVIDIA GeForce RTX 3090",
        "memoryTotal": 24576,
        "memoryUsed": 8192,
        "memoryFree": 16384
      }
    ]
  }
}
```

#### POST `/api/llm/test`
Testet die LLM-Konnektivität.

**Rate Limit**: STRICT

**Request Body:**
```json
{
  "prompt": "Test prompt"
}
```

**Response:**
```json
{
  "ok": true,
  "response": "string",
  "duration": 1234,
  "model": "llama3.1:8b"
}
```

#### GET `/api/llm/config`
Aktuelle LLM-Konfiguration.

**Response:**
```json
{
  "ok": true,
  "config": {
    "baseUrl": "http://127.0.0.1:11434",
    "chatModel": "llama3.1:8b",
    "embedModel": "mxbai-embed-large",
    "temperature": 0.05,
    "seed": 42,
    "numCtx": 8192
  }
}
```

#### POST `/api/llm/model`
Setzt das aktive Modell global.

**Request Body:**
```json
{
  "modelKey": "llama3.1:8b"
}
```

#### POST `/api/llm/task-model`
Konfiguriert ein Modell für einen spezifischen Task-Typ.

**Request Body:**
```json
{
  "taskType": "chat|sim|ops|start",
  "modelKey": "llama3.1:8b"
}
```

#### GET `/api/llm/model/:taskType`
Gibt die Modell-Konfiguration für einen Task zurück.

**Response:**
```json
{
  "ok": true,
  "taskType": "chat",
  "model": "llama3.1:8b",
  "timeout": 60000
}
```

#### POST `/api/llm/test-model`
Testet ein spezifisches Modell.

**Rate Limit**: STRICT

**Request Body:**
```json
{
  "modelKey": "llama3.1:8b",
  "prompt": "Test prompt"
}
```

#### GET `/api/llm/profiles`
Listet verfügbare Modellprofile auf.

**Response:**
```json
{
  "ok": true,
  "profiles": [
    {
      "id": "default",
      "name": "Standard",
      "models": {
        "chat": "llama3.1:8b",
        "sim": "llama3.1:8b"
      }
    }
  ]
}
```

---

### Audit Trail (Übungsprotokollierung)

#### GET `/api/audit/status`
Aktueller Audit-Status.

**Response:**
```json
{
  "ok": true,
  "recording": true,
  "exerciseId": "string",
  "startTime": "ISO-8601 timestamp",
  "eventCount": 142
}
```

#### POST `/api/audit/start`
Beginnt die Audit-Trail-Aufzeichnung.

**Request Body:**
```json
{
  "name": "Übung: Hochwasser 2026",
  "description": "string",
  "participants": ["S1", "S2", "S3"]
}
```

**Response:**
```json
{
  "ok": true,
  "exerciseId": "string",
  "startTime": "ISO-8601 timestamp"
}
```

#### POST `/api/audit/end`
Beendet die Audit-Trail-Aufzeichnung.

**Response:**
```json
{
  "ok": true,
  "exerciseId": "string",
  "endTime": "ISO-8601 timestamp",
  "eventCount": 142,
  "duration": 7200
}
```

#### GET `/api/audit/list`
Listet alle aufgezeichneten Übungen auf.

**Response:**
```json
{
  "ok": true,
  "exercises": [
    {
      "id": "string",
      "name": "string",
      "startTime": "ISO-8601 timestamp",
      "endTime": "ISO-8601 timestamp",
      "eventCount": 142,
      "participants": ["S1", "S2"]
    }
  ]
}
```

#### GET `/api/audit/:exerciseId`
Lädt eine spezifische Übung.

**Response:**
```json
{
  "ok": true,
  "exercise": {
    "id": "string",
    "name": "string",
    "events": [
      {
        "timestamp": "ISO-8601 timestamp",
        "type": "string",
        "actor": "S1",
        "action": "string",
        "data": {}
      }
    ]
  }
}
```

#### DELETE `/api/audit/:exerciseId`
Löscht eine Übung.

**Response:**
```json
{
  "ok": true
}
```

#### POST `/api/audit/pause`
Pausiert eine Übung.

**Response:**
```json
{
  "ok": true,
  "paused": true
}
```

#### POST `/api/audit/resume`
Setzt eine Übung fort.

**Response:**
```json
{
  "ok": true,
  "paused": false
}
```

#### POST `/api/audit/events`
Fragt gefilterte Events ab.

**Request Body:**
```json
{
  "exerciseId": "string",
  "filters": {
    "type": "string",
    "actor": "S1",
    "fromTime": "ISO-8601 timestamp",
    "toTime": "ISO-8601 timestamp"
  }
}
```

---

### Templates (Übungsvorlagen)

#### GET `/api/templates`
Listet alle Templates auf.

**Response:**
```json
{
  "ok": true,
  "templates": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "category": "hochwasser|sturm|schnee",
      "created": "ISO-8601 timestamp"
    }
  ]
}
```

#### GET `/api/templates/:templateId`
Lädt ein Template.

**Response:**
```json
{
  "ok": true,
  "template": {
    "id": "string",
    "name": "string",
    "content": {},
    "variables": []
  }
}
```

#### POST `/api/templates`
Erstellt ein neues Template.

**Request Body:**
```json
{
  "name": "string",
  "description": "string",
  "category": "string",
  "content": {}
}
```

#### DELETE `/api/templates/:templateId`
Löscht ein Template.

#### POST `/api/templates/:templateId/create-exercise`
Generiert eine Übung aus einem Template.

**Request Body:**
```json
{
  "variables": {
    "location": "Feldkirchen",
    "severity": "medium"
  }
}
```

**Response:**
```json
{
  "ok": true,
  "exerciseId": "string",
  "scenario": {}
}
```

---

### Katastrophen-Kontext

#### GET `/api/disaster/current`
Gibt den aktuellen Katastrophen-Kontext zurück.

**Response:**
```json
{
  "ok": true,
  "disaster": {
    "id": "string",
    "type": "hochwasser|sturm|schnee",
    "severity": "medium",
    "startTime": "ISO-8601 timestamp",
    "location": "string",
    "status": "active|completed"
  }
}
```

#### GET `/api/disaster/summary`
Katastrophen-Kontext-Zusammenfassung.

**Response:**
```json
{
  "ok": true,
  "summary": "string",
  "keyEvents": [],
  "currentPhase": "string"
}
```

#### POST `/api/disaster/init`
Initialisiert einen neuen Katastrophen-Kontext.

**Request Body:**
```json
{
  "type": "hochwasser",
  "severity": "medium",
  "location": "Feldkirchen",
  "initialConditions": {}
}
```

#### POST `/api/disaster/update`
Aktualisiert den Katastrophen-Kontext.

**Request Body:**
```json
{
  "phase": "string",
  "events": [],
  "conditions": {}
}
```

#### GET `/api/disaster/list`
Listet alle Katastrophen-Kontexte auf.

**Response:**
```json
{
  "ok": true,
  "disasters": [
    {
      "id": "string",
      "type": "string",
      "startTime": "ISO-8601 timestamp",
      "endTime": "ISO-8601 timestamp",
      "status": "active|completed"
    }
  ]
}
```

#### GET `/api/disaster/:disasterId`
Lädt eine spezifische Katastrophe.

#### POST `/api/disaster/finalize`
Finalisiert und schließt eine Katastrophe.

**Response:**
```json
{
  "ok": true,
  "disasterId": "string",
  "endTime": "ISO-8601 timestamp",
  "summary": "string"
}
```

#### POST `/api/disaster/record-suggestion`
Zeichnet LLM-Vorschläge für das Lernen auf.

**Request Body:**
```json
{
  "context": "string",
  "suggestion": "string",
  "accepted": true
}
```

---

### Feedback & Lernen

#### POST `/api/feedback`
Speichert Feedback zu einer LLM-Antwort.

**Request Body:**
```json
{
  "responseId": "string",
  "rating": 1-5,
  "comment": "string",
  "helpful": true
}
```

**Response:**
```json
{
  "ok": true,
  "feedbackId": "string"
}
```

#### GET `/api/feedback/list`
Listet alle Feedbacks auf.

**Response:**
```json
{
  "ok": true,
  "feedback": [
    {
      "id": "string",
      "responseId": "string",
      "rating": 4,
      "comment": "string",
      "timestamp": "ISO-8601 timestamp"
    }
  ]
}
```

#### GET `/api/feedback/stats`
Feedback-Statistiken.

**Response:**
```json
{
  "ok": true,
  "stats": {
    "totalFeedback": 150,
    "averageRating": 4.2,
    "helpfulPercentage": 85.5
  }
}
```

#### POST `/api/feedback/similar`
Findet ähnliche gelernte Antworten.

**Request Body:**
```json
{
  "query": "string",
  "topK": 5
}
```

**Response:**
```json
{
  "ok": true,
  "results": [
    {
      "response": "string",
      "similarity": 0.92,
      "context": "string"
    }
  ]
}
```

#### POST `/api/feedback/learned-context`
Gibt gelernten Antwort-Kontext zurück.

**Request Body:**
```json
{
  "query": "string"
}
```

**Response:**
```json
{
  "ok": true,
  "context": "string",
  "sources": []
}
```

---

### Administration

#### GET `/api/admin/rate-limit-stats`
Rate-Limit-Statistiken.

**Rate Limit**: ADMIN

**Response:**
```json
{
  "ok": true,
  "stats": {
    "totalRequests": 1000,
    "rateLimited": 5,
    "perEndpoint": {
      "/api/chat": {
        "requests": 500,
        "limited": 2
      }
    }
  }
}
```

#### GET `/api/events`
Event-Stream abrufen.

**Response (Server-Sent Events):**
```
Content-Type: text/event-stream

event: message
data: {"type": "update", "data": {}}
```

---

### UI-Routen

#### GET `/dashboard`
Chatbot-Dashboard.

#### GET `/`
Haupt-UI-Einstiegspunkt.

#### GET `/gui/**`
Statische GUI-Dateien.

---

## Konfigurationsvariablen

### Server-Konfiguration

```bash
# Express-Server-Port
PORT=4040

# Optionales Log-Verzeichnis
KANBAN_LOG_DIR=./logs

# Erzwingt sichere Cookies für HTTPS (1=ja, 0=nein)
KANBAN_COOKIE_SECURE=1

# Board-Cache-Dauer in Millisekunden
BOARD_CACHE_MAX_AGE_MS=60000

# Fahrzeug-Cache-TTL in Millisekunden
VEHICLE_CACHE_TTL_MS=10000

# Basis-Datenverzeichnis
DATA_DIR=./data

# Statische Dateien
PUBLIC_DIR=./public
```

---

### UI-Polling

```bash
# Fetcher-Status-Polling-Intervall (ms)
UI_STATUS_POLL_INTERVAL_MS=3000

# Aktivitäts-Status-Polling-Intervall (ms)
UI_ACTIVITY_POLL_INTERVAL_MS=1000
```

---

### Feuerwehr-Feed

```bash
# Ausgabedatei für Einsatzfeed
FF_OUT_FILE=./data/list_filtered.json

# GPS-Ausgabedatei
FF_GPS_OUT_FILE=./data/vehicles_gps.json

# Feed-Polling-Intervall (ms)
FF_POLL_INTERVAL_MS=60000

# Aktivitätsüberwachungs-Intervall (ms)
FF_ACTIVITY_SWEEP_INTERVAL_MS=60000

# Detailliertes Logging (1=aktiviert)
FF_DEBUG=1

# Endpunkt-Pfad für List
FF_LIST_PATH=/list

# Zusätzliche Query-Parameter
FF_LIST_EXTRA=""

# Feed-Staleness-Timeout (Minuten)
FF_LIST_TIMEOUT_MIN=2880

# GPS-Endpunkt-Pfad
FF_GPS_PATH=/status/gps

# Einzeldurchlauf-Modus (1=aktiviert)
FF_ONCE=0

# Benutzerdefiniertes CA-Zertifikat
FF_CA_FILE=./feuerwehr_fullchain.pem

# Lock-Datei-Pfad
FF_LOCK_FILE=""

# Auto-Stop nach Inaktivität (Minuten)
FF_AUTO_STOP_MIN=30

# Basic-Auth-Benutzername
FF_USERNAME=""

# Basic-Auth-Passwort
FF_PASSWORD=""

# Näherungssuche Standard-Radius (km)
NEARBY_RADIUS_KM=1
NEARBY_RADIUS_MIN_KM=0.1
NEARBY_RADIUS_MAX_KM=50
```

---

### Auto-Import & Auto-Print

```bash
# Standard-Import-Intervall (Sekunden)
AUTO_IMPORT_DEFAULT_INTERVAL_SEC=30

# Standard-Druck-Intervall (Minuten)
AUTO_PRINT_DEFAULT_INTERVAL_MINUTES=10
AUTO_PRINT_MIN_INTERVAL_MINUTES=1

# Mail-Schedule Standard-Intervall
MAIL_SCHEDULE_DEFAULT_INTERVAL_MINUTES=60

# API-Schedule Standard-Intervall
API_SCHEDULE_DEFAULT_INTERVAL_MINUTES=60
```

---

### WMS/Kartendienst

```bash
# WMS-Service-Port
WMS_PORT=8090

# WMS-Titel
WMS_TITLE="Lagekarte Board WMS"

# WMS-Beschreibung
WMS_ABSTRACT="Einsätze & Fahrzeuge"

# Labels anzeigen (1=ja)
WMS_LABELS=1

# Label-Schriftart
WMS_LABEL_FONT="12px Sans-Serif"

# Label-Farbe
WMS_LABEL_COLOR="#000000"

# Label-Umriss
WMS_LABEL_OUTLINE="#ffffff"
WMS_LABEL_OUTLINE_W=3

# Maximale Label-Länge
WMS_LABEL_TRIM=28

# Debug-Logging
WMS_DEBUG=0
```

---

### Druckverzeichnisse

```bash
# Meldungs-Druckverzeichnis
KANBAN_MELDUNG_PRINT_DIR=./data/prints/meldung

# Einsatz-Druckverzeichnis
KANBAN_EINSATZ_PRINT_DIR=./data/prints/einsatz

# Protokoll-Druckverzeichnis
KANBAN_PROTOKOLL_PRINT_DIR=./data/prints/protokoll

# Puppeteer Chromium-Pfad (optional)
PUPPETEER_EXECUTABLE_PATH=""
```

---

### Benutzersitzungen

```bash
# Sitzungs-Timeout bei Inaktivität (Minuten)
USER_SESSION_IDLE_TIMEOUT_MIN=15
USER_SESSION_IDLE_TIMEOUT_MS=900000

# Sitzungs-Cleanup-Intervall (ms)
USER_SESSION_SWEEP_INTERVAL_MS=60000

# Hinweis: Online-Role-Aktivitätsfenster = Session-Timeout
# Eine Rolle gilt als aktiv solange die Session gültig ist.
```

---

### Aufgaben

```bash
# Standard-Fälligkeitsversatz (Minuten)
DEFAULT_DUE_OFFSET_MINUTES=10
TASK_DEFAULT_DUE_OFFSET_MINUTES=10
AUFG_DEFAULT_DUE_MINUTES=10
```

---

### Mail/SMTP

```bash
# SMTP-Server
MAIL_HOST=smtp.example.com
MAIL_PORT=587

# SMTPS verwenden (1=ja)
MAIL_SECURE=0

# STARTTLS anfordern
MAIL_STARTTLS=1

# SMTP-Zugangsdaten
MAIL_USER=user@example.com
MAIL_PASSWORD=secret

# Absender-Adresse
MAIL_FROM=user@example.com

# Whitelisted Absender
MAIL_ALLOWED_FROM=user@example.com

# SMTP-Logging aktivieren
MAIL_LOG=0

# Nach Lesen löschen
MAIL_DELETE_AFTER_READ=1

# Posteingang-Polling-Intervall (Sekunden)
MAIL_INBOX_POLL_INTERVAL_SEC=60

# Max. Mails pro Polling
MAIL_INBOX_POLL_LIMIT=50

# IMAP-Konfiguration
MAIL_IMAP_HOST=""
MAIL_IMAP_PORT=993
MAIL_IMAP_SECURE=1
MAIL_IMAP_USER=""
MAIL_IMAP_PASSWORD=""

# POP3-Konfiguration
MAIL_POP3_HOST=""
MAIL_POP3_PORT=995
MAIL_POP3_SECURE=1
```

---

### Chatbot LLM

```bash
# Profil-Auswahl
CHATBOT_PROFILE=default

# LLM-Server-URL (Ollama)
LLM_BASE_URL=http://127.0.0.1:11434

# Modell-Namen
LLM_CHAT_MODEL=llama3.1:8b
LLM_EMBED_MODEL=mxbai-embed-large
LLM_MODEL_FAST=llama3.1:8b
LLM_MODEL_BALANCED=einfo-balanced

# Timeouts (ms)
LLM_TIMEOUT_FAST=30000
LLM_TIMEOUT_BALANCED=220000
LLM_CHAT_TIMEOUT_MS=60000
LLM_SIM_TIMEOUT_MS=300000
LLM_EMBED_TIMEOUT_MS=30000
LLM_TIMEOUT_MS=240000

# Kontext-Fenster
LLM_NUM_CTX=8192
LLM_NUM_BATCH=512

# Temperatur und Seed
LLM_TEMP=0.05
LLM_SEED=42

# Task-spezifische Modelle
LLM_TASK_START=balanced
LLM_TASK_OPS=balanced
LLM_TASK_CHAT=balanced

# Globale Modell-Überschreibung
LLM_MODEL=auto
```

---

### RAG & Embeddings

```bash
# Embedding-Dimension
RAG_DIM=1024

# Max. Index-Elemente
RAG_MAX_ELEM=50000

# Top K ähnliche abrufen
RAG_TOP_K=5

# Max. Kontext-Zeichen
RAG_MAX_CTX=2500

# Relevanz-Schwellenwert
RAG_SCORE_THRESHOLD=0.35

# Embedding-Cache-Größe
EMBED_CACHE_SIZE=200

# Prompt-Limits
PROMPT_MAX_BOARD=25
PROMPT_MAX_AUFGABEN=50
PROMPT_MAX_PROTOKOLL=30

# Memory-RAG
MEM_RAG_LONG_MIN_ITEMS=100
MEM_RAG_MAX_AGE_MIN=720
MEM_RAG_HALF_LIFE_MIN=120
MEM_RAG_LONG_TOP_K=12
```

---

### Simulation

```bash
# Simulation Worker-Intervall (ms)
SIM_WORKER_INTERVAL_MS=60000

# Max. Wiederholungsversuche
SIM_MAX_RETRIES=3

# Wiederholungsverzögerung (ms)
SIM_RETRY_DELAY_MS=5000

# Haupt-Server-URL
MAIN_SERVER_URL=http://localhost:4040

# Auto-Step-Intervall (ms)
CHATBOT_AUTO_STEP_MS=120000

# Debug-Logging
CHATBOT_DEBUG=0
```

---

### GPU/Ollama

```bash
# CUDA-Geräte-Auswahl
CUDA_VISIBLE_DEVICES=0

# GPU-Layer für VRAM-Optimierung
OLLAMA_NUM_GPU=22

# Gleichzeitige Modelle
OLLAMA_MAX_LOADED_MODELS=1

# Modell-Keep-Alive-Zeit
OLLAMA_KEEP_ALIVE=30m
```

---

## Dateibasierte Konfigurationen

### Datenkonfigurationsdateien

Speicherort: `/home/user/EINFO/server/data/conf/`

- **auto-import.json**: Auto-Import-Einstellungen
- **mail-rules.json**: E-Mail-Regel-Definitionen
- **mail-schedule.json**: Geplante Mail-Templates
- **weather-categories.json**: Wetterwarnungs-Kategorien
- **types.json**: Fahrzeugtyp-Definitionen
- **group-alerted.json**: Gruppen-Alarmierungsstatus
- **vehicles.json**: Basis-Fahrzeugdefinitionen
- **api-schedule.json**: HTTP-Webhook-Schedules

### Szenariendateien

Speicherort: `/home/user/EINFO/chatbot/server/scenarios/`

- **hochwasser_feldkirchen.json**: Hochwasser-Szenario
- **sturm_bezirk.json**: Sturm-Szenario
- **hochwasser_basic.json**: Basis-Hochwasser-Szenario

### Wissensbasis

Speicherort: `/home/user/EINFO/chatbot/knowledge/`

- **rollen_*.json**: Rollenspezifisches Wissen (S1-S6, LtStb, Einsatzleiter)
- **rag_*_hazards.json**: Gefahrenspezifische RAG-Daten (Hochwasser, Sturm, Muren, Schnee, Unfälle)
- **knowledge_index/**: Vorberechnete Embeddings

---

## Fehlerbehandlung & Statuscodes

### Standard-Fehlerantwort-Format

```json
{
  "ok": false,
  "error": "error_code",
  "detail": "Detaillierte Fehlermeldung"
}
```

### HTTP-Statuscodes

- **200**: OK - Erfolgreiche Anfrage
- **400**: Bad Request - Ungültige Anfrage-Parameter
- **403**: Forbidden - Keine Berechtigung oder System gesperrt
- **500**: Server Error - Interner Serverfehler
- **503**: Service Unavailable - Service nicht verfügbar (z.B. LLM offline)

### Typische Fehlercodes

- `master_locked`: System ist mit Master-Passwort gesperrt
- `not_authenticated`: Keine gültige Sitzung
- `permission_denied`: Unzureichende Berechtigungen
- `resource_not_found`: Ressource nicht gefunden
- `validation_error`: Validierungsfehler
- `llm_timeout`: LLM-Anfrage-Timeout
- `rate_limited`: Rate-Limit überschritten

---

## Authentifizierung

### Session-basierte Authentifizierung

Das System verwendet Cookie-basierte Sitzungen:

1. **Login**: POST `/api/user/login` mit Benutzerdaten
2. **Session-Cookie**: Server setzt `connect.sid` Cookie
3. **Geschützte Routen**: Senden Cookie bei jeder Anfrage
4. **Logout**: POST `/api/user/logout` zerstört Sitzung

### Master-Passwort-System

- System kann mit Master-Passwort gesperrt werden
- Gesperrtes System: Alle Anfragen (außer Unlock) werden mit 403 abgelehnt
- Entsperren: POST `/api/user/master/unlock`

### Rollenbasierte Berechtigungen

Rollen werden in der Benutzer-Datenbank definiert:
- **Admin**: Volle Systemzugriff
- **S1-S6**: Stabsfunktionen mit spezifischen Berechtigungen
- **Einsatzleiter**: Einsatzleitungs-Berechtigungen
- **Beobachter**: Nur-Lese-Zugriff

---

## Beispiele

### Beispiel 1: Benutzer-Login und Board abrufen

```bash
# 1. Login
curl -X POST http://localhost:4040/api/user/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "secret"}' \
  -c cookies.txt

# 2. Board abrufen (mit Session-Cookie)
curl http://localhost:4040/api/board \
  -b cookies.txt
```

### Beispiel 2: Neue Einsatzkarte erstellen

```bash
curl -X POST http://localhost:4040/api/cards \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "title": "Hochwasser Hauptstraße",
    "description": "Keller überflutet, 2 Personen betroffen",
    "priority": 1,
    "columnId": "eingehend"
  }'
```

### Beispiel 3: Fahrzeug zuweisen

```bash
curl -X POST http://localhost:4040/api/cards/card123/assign \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "vehicleIds": ["FF_Feldkirchen_1", "FF_Feldkirchen_2"]
  }'
```

### Beispiel 4: Protokolleintrag erstellen

```bash
curl -X POST http://localhost:4040/api/protocol \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "content": "14:30 - Einsatzbeginn Hochwasser Hauptstraße. FF Feldkirchen 1+2 alarmiert."
  }'
```

### Beispiel 5: Chatbot-Nachricht senden (Streaming)

```bash
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Was sind die aktuellen Prioritäten?",
    "context": {
      "role": "S1",
      "simulationId": "sim123"
    }
  }'
```

### Beispiel 6: Simulation starten

```bash
curl -X POST http://localhost:3001/api/sim/start \
  -H "Content-Type: application/json" \
  -d '{
    "scenarioId": "hochwasser_feldkirchen",
    "options": {
      "autoStep": true,
      "stepIntervalMs": 120000
    }
  }'
```

### Beispiel 7: Fahrzeuge in der Nähe finden

```bash
curl "http://localhost:4040/api/nearby?lat=46.7167&lng=14.1833&radiusKm=5" \
  -b cookies.txt
```

### Beispiel 8: E-Mail senden

```bash
curl -X POST http://localhost:4040/api/mail/send \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "to": "einsatzleiter@example.com",
    "subject": "Lagemeldung - Hochwasser",
    "text": "Aktueller Status: 3 Einsätze aktiv, 12 Fahrzeuge im Einsatz.",
    "from": "leitstelle@example.com"
  }'
```

### Beispiel 9: Audit-Trail starten

```bash
curl -X POST http://localhost:3001/api/audit/start \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Übung: Hochwasser 2026-01-05",
    "description": "Großübung Hochwasserszenario",
    "participants": ["S1", "S2", "S3", "S4", "Einsatzleiter"]
  }'
```

### Beispiel 10: Geplante E-Mail erstellen

```bash
curl -X POST http://localhost:4040/api/mail/schedule \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "name": "Stündliche Lagemeldung",
    "enabled": true,
    "intervalMinutes": 60,
    "to": "stab@example.com",
    "subject": "Lagemeldung {{timestamp}}",
    "template": "Aktive Einsätze: {{activeIncidents}}\nVerfügbare Fahrzeuge: {{availableVehicles}}"
  }'
```

---

## Architektur-Entscheidungen

1. **Monorepo-Struktur**: Client und Server in Workspace-Konfiguration
2. **Express.js Framework**: Beide Server verwenden Express für HTTP-Routing
3. **JSON-basierte APIs**: Alle Datenaustausch via JSON (Limit: 10MB)
4. **Session-basierte Authentifizierung**: Cookie-basierte Sitzungen mit konfigurierbarem Timeout
5. **Umgebungsgesteuerte Konfiguration**: Alle Einstellungen via Umgebungsvariablen mit Fallback-Standards
6. **Mehrstufiges Rate-Limiting**: Chatbot verwendet Profile (STRICT, GENEROUS, ADMIN)
7. **Modulare Route-Handler**: Routen nach Feature-Domain aufgeteilt
8. **Streaming-Unterstützung**: Chatbot unterstützt Streaming-Antworten für Chat
9. **Async/Await-Pattern**: Modernes Async/Await für alle asynchronen Operationen
10. **Graceful Degradation**: Optionale Features (Mail, WMS) mit Fallback-Verhalten

---

## Zusammenfassung

EINFO ist ein **deutschsprachiges Einsatzleitsystem mit KI-gestützter Katastrophensimulation**:

- **50+ REST API-Endpoints** über zwei Server
- **30+ Umgebungskonfigurations-Variablen** für flexible Bereitstellung
- **Multi-Modell-LLM-Unterstützung** mit aufgabenspezifischem Routing
- **Umfassende Audit-Trail-Funktionen** für Übungen
- **Echtzeit-Einsatz-Board** mit Fahrzeugverfolgung und -zuweisung
- **Automatisierte Mail/Webhook-Planung** für Benachrichtigungen
- **Vector-RAG-System** für Wissensabruf in Simulationen
- **Produktionsreife Architektur** mit ordnungsgemäßer Trennung von Belangen

---

**Version**: 1.0
**Erstellt**: 2026-01-05
**Projekt**: EINFO - Einsatzleitsystem mit Katastrophensimulation
