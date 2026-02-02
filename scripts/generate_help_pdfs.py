#!/usr/bin/env python3
"""
Generiert die Hilfe-PDFs fuer alle Boards der EINFO-Anwendung.
Ausgabe: client/public/Hilfe.pdf, Hilfe_Aufgabenboard.pdf, Hilfe_Meldestelle.pdf
"""

import os
from fpdf import FPDF

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "client", "public")

# DejaVu Sans supports full Unicode including German umlauts
FONT_DIR = "/usr/share/fonts/truetype/dejavu"
FONT_REGULAR = os.path.join(FONT_DIR, "DejaVuSans.ttf")
FONT_BOLD = os.path.join(FONT_DIR, "DejaVuSans-Bold.ttf")
FONT_ITALIC = os.path.join(FONT_DIR, "DejaVuSans.ttf")  # no oblique variant available


class HilfePDF(FPDF):
    """Basis-PDF mit einheitlichem Layout für EINFO-Hilfeseiten."""

    def __init__(self, title_text=""):
        super().__init__()
        self.title_text = title_text
        self.set_auto_page_break(auto=True, margin=20)
        # Register Unicode font
        self.add_font("DejaVu", "", FONT_REGULAR)
        self.add_font("DejaVu", "B", FONT_BOLD)
        self.add_font("DejaVu", "I", FONT_ITALIC)

    # ------------------------------------------------------------------
    def header(self):
        self.set_font("DejaVu", "B", 10)
        self.set_text_color(100, 100, 100)
        self.cell(0, 6, self.title_text, align="L")
        self.ln(8)
        self.set_draw_color(200, 200, 200)
        self.line(10, self.get_y(), self.w - 10, self.get_y())
        self.ln(4)

    def footer(self):
        self.set_y(-15)
        self.set_font("DejaVu", "I", 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 10, f"Seite {self.page_no()}/{{nb}}", align="C")

    # ------------------------------------------------------------------
    def chapter_title(self, title):
        self.set_font("DejaVu", "B", 14)
        self.set_text_color(30, 60, 120)
        self.cell(0, 10, title, new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(30, 60, 120)
        self.line(10, self.get_y(), self.w - 10, self.get_y())
        self.ln(4)

    def section_title(self, title):
        self.set_font("DejaVu", "B", 12)
        self.set_text_color(50, 50, 50)
        self.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT")
        self.ln(2)

    def sub_section(self, title):
        self.set_font("DejaVu", "B", 10)
        self.set_text_color(70, 70, 70)
        self.cell(0, 7, title, new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def body(self, text):
        self.set_font("DejaVu", "", 10)
        self.set_text_color(30, 30, 30)
        self.multi_cell(0, 5.5, text)
        self.ln(2)

    def bullet(self, text, indent=10):
        self.set_font("DejaVu", "", 10)
        self.set_text_color(30, 30, 30)
        self.cell(indent, 5.5, "\u2022")
        self.multi_cell(self.w - 2 * self.l_margin - indent, 5.5, text)
        self.ln(1)

    def cover_page(self, title, subtitle=""):
        self.add_page()
        self.ln(60)
        self.set_font("DejaVu", "B", 28)
        self.set_text_color(30, 60, 120)
        self.cell(0, 15, title, align="C", new_x="LMARGIN", new_y="NEXT")
        if subtitle:
            self.ln(6)
            self.set_font("DejaVu", "", 14)
            self.set_text_color(80, 80, 80)
            self.cell(0, 10, subtitle, align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(20)
        self.set_font("DejaVu", "", 11)
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, "EINFO \u2013 Einsatzinformationssystem", align="C", new_x="LMARGIN", new_y="NEXT")
        self.cell(0, 8, "Benutzerhandbuch", align="C", new_x="LMARGIN", new_y="NEXT")

    def role_table(self, rows):
        """rows = [(rolle, beschreibung, berechtigung), ...]"""
        self.set_font("DejaVu", "B", 9)
        self.set_fill_color(30, 60, 120)
        self.set_text_color(255, 255, 255)
        col_w = [30, 90, 55]
        self.cell(col_w[0], 7, "Rolle", border=1, fill=True)
        self.cell(col_w[1], 7, "Beschreibung", border=1, fill=True)
        self.cell(col_w[2], 7, "Berechtigung", border=1, fill=True)
        self.ln()
        self.set_text_color(30, 30, 30)
        self.set_font("DejaVu", "", 9)
        fill = False
        for rolle, beschr, recht in rows:
            if fill:
                self.set_fill_color(240, 240, 250)
            else:
                self.set_fill_color(255, 255, 255)
            self.cell(col_w[0], 6, rolle, border=1, fill=True)
            self.cell(col_w[1], 6, beschr, border=1, fill=True)
            self.cell(col_w[2], 6, recht, border=1, fill=True)
            self.ln()
            fill = not fill
        self.ln(4)


# ======================================================================
#  EINSATZBOARD
# ======================================================================
def generate_einsatzboard():
    pdf = HilfePDF("EINFO \u2013 Hilfe Einsatzboard")
    pdf.alias_nb_pages()

    # -- Deckblatt --
    pdf.cover_page("Einsatzboard", "Hilfe und Bedienungsanleitung")

    # -- Übersicht --
    pdf.add_page()
    pdf.chapter_title("1. Übersicht")
    pdf.body(
        "Das Einsatzboard ist die zentrale Übersicht aller laufenden Einsätze. "
        "Es ist als Kanban-Board mit drei Spalten aufgebaut:"
    )
    pdf.bullet("Neu \u2013 Alle neu eingegangenen oder manuell angelegten Einsätze.")
    pdf.bullet("In Bearbeitung \u2013 Einsätze, die aktiv bearbeitet werden.")
    pdf.bullet("Erledigt \u2013 Abgeschlossene Einsätze.")
    pdf.body(
        "Jede Spalte zeigt die Anzahl der Einsätze, zugewiesenen Fahrzeuge und "
        "eingesetzten Personen an. Am oberen Rand sehen Sie zudem die letzte Aktualisierungszeit."
    )

    # -- Rollen --
    pdf.add_page()
    pdf.chapter_title("2. Rollen und Berechtigungen")
    pdf.body(
        "Je nach zugewiesener Rolle haben Sie unterschiedliche Berechtigungen auf dem Einsatzboard:"
    )
    pdf.role_table([
        ("Admin", "Systemadministrator", "Bearbeiten"),
        ("S2", "Lage und Information", "Bearbeiten"),
        ("LtStb", "Leiter Stab", "Bearbeiten"),
        ("MS", "Meldestelle", "Nur Ansicht"),
        ("S1", "Personal", "Nur Ansicht"),
        ("S3", "Einsatz / Operation", "Nur Ansicht"),
        ("S4", "Versorgung / Logistik", "Nur Ansicht"),
        ("S5", "Öffentlichkeitsarbeit", "Nur Ansicht"),
        ("S6", "IT / Kommunikation", "Nur Ansicht"),
        ("Mitarbeiter", "Allgemeiner Mitarbeiter", "Nur Ansicht"),
    ])
    pdf.body(
        "Benutzer mit der Berechtigung \u201eBearbeiten\u201c können Einsätze anlegen, "
        "verschieben, Fahrzeuge zuweisen und die Verfügbarkeit von Einheiten ändern. "
        "Benutzer mit \u201eNur Ansicht\u201c sehen alle Informationen, können aber keine Änderungen vornehmen."
    )

    pdf.section_title("Aufgaben der Rollen im Kontext des Einsatzboards")
    pdf.bullet(
        "Admin / S2 / LtStb: Erstellen und verwalten Einsätze, weisen Fahrzeuge zu, "
        "ändern Fahrzeugverfügbarkeiten, importieren Daten und exportieren PDFs."
    )
    pdf.bullet(
        "S1 (Personal): Überwacht die Personalstärke und Fahrzeugbesetzungen. "
        "Kann sich einen Überblick verschaffen, welche Einheiten eingesetzt sind."
    )
    pdf.bullet(
        "S3 (Einsatz): Beobachtet den Einsatzverlauf, um operative Entscheidungen "
        "vorzubereiten. Nutzt die Informationen für die Einsatzplanung."
    )
    pdf.bullet(
        "S4 (Versorgung): Überblick über eingesetzte Einheiten für die Logistikplanung."
    )
    pdf.bullet(
        "MS (Meldestelle): Beobachtet die Lage, um Meldungen korrekt zuordnen zu können."
    )

    # -- Einsatz anlegen --
    pdf.add_page()
    pdf.chapter_title("3. Einen neuen Einsatz anlegen")
    pdf.body(
        "Klicken Sie auf die Schaltfläche mit dem Plus-Symbol (+) unten rechts "
        "auf dem Bildschirm. Es öffnet sich ein Formular mit folgenden Feldern:"
    )
    pdf.bullet("Typ \u2013 Wählen Sie den Einsatztyp aus der Auswahlliste (z.\u202fB. Brand, Technischer Einsatz).")
    pdf.bullet("Titel \u2013 Geben Sie eine kurze Beschreibung des Einsatzes ein. Wird automatisch vom Typ vorbelegt.")
    pdf.bullet(
        "Ort \u2013 Geben Sie die Adresse ein. Es werden automatisch Vorschläge angezeigt. "
        "Die Koordinaten werden automatisch ermittelt."
    )
    pdf.bullet("Notiz \u2013 Optionale zusätzliche Informationen zum Einsatz.")
    pdf.bullet(
        "Abschnitt \u2013 Aktivieren Sie das Häkchen, um diesen Einsatz als Abschnitt zu definieren. "
        "Abschnitte dienen zur geographischen Gruppierung und erhalten eine eigene Farbe."
    )
    pdf.body(
        "Klicken Sie auf \u201eAnlegen\u201c, um den Einsatz zu erstellen. "
        "Mit \u201eDrucken\u201c können Sie den Einsatz direkt nach dem Anlegen ausdrucken."
    )

    # -- Einsatzkarten --
    pdf.add_page()
    pdf.chapter_title("4. Einsatzkarten verwalten")

    pdf.section_title("4.1 Karten verschieben (Drag & Drop)")
    pdf.body(
        "Ziehen Sie eine Einsatzkarte mit der Maus von einer Spalte in eine andere, "
        "um den Status zu ändern:"
    )
    pdf.bullet("Von \u201eNeu\u201c nach \u201eIn Bearbeitung\u201c \u2013 Der Einsatz wird aktiv bearbeitet.")
    pdf.bullet(
        "Von \u201eIn Bearbeitung\u201c nach \u201eErledigt\u201c \u2013 Der Einsatz wird abgeschlossen. "
        "Es erscheint eine Sicherheitsabfrage."
    )
    pdf.bullet("Innerhalb einer Spalte können Sie die Reihenfolge der Karten ändern.")

    pdf.section_title("4.2 Einsatzdetails anzeigen und bearbeiten")
    pdf.body(
        "Klicken Sie auf eine Einsatzkarte, um die Detailansicht zu öffnen. "
        "Dort sehen Sie alle Informationen zum Einsatz:"
    )
    pdf.bullet("Titel, Typ, Einsatz-ID, Alarmzeit")
    pdf.bullet("Adresse und Standort auf der Karte")
    pdf.bullet("Zugewiesene Fahrzeuge und Personalstärke")
    pdf.bullet("Notizen und Abschnittszugehörigkeit")
    pdf.body(
        "Klicken Sie auf \u201eBearbeiten\u201c, um die Felder zu ändern. "
        "Mit \u201eSpeichern\u201c übernehmen Sie die Änderungen."
    )

    pdf.section_title("4.3 Einsatz per E-Mail versenden")
    pdf.body(
        "In der Detailansicht können Sie über \u201eMail senden\u201c die Einsatzinformationen "
        "per E-Mail an konfigurierte Empfänger verschicken."
    )

    pdf.section_title("4.4 Einsatz drucken")
    pdf.body(
        "Über \u201eDrucken\u201c in der Detailansicht wird ein Ausdruck mit allen Einsatzinformationen "
        "und einer Kartenansicht erzeugt."
    )

    # -- Fahrzeuge & Einheiten --
    pdf.add_page()
    pdf.chapter_title("5. Fahrzeuge und Einheiten")

    pdf.section_title("5.1 Seitenleiste \u201eFreie Einheiten\u201c")
    pdf.body(
        "Auf der rechten Seite des Einsatzboards sehen Sie die Seitenleiste mit allen "
        "verfügbaren Einheiten, gruppiert nach Standort (Ort). "
        "Gruppen können Sie auf- und zuklappen."
    )

    pdf.section_title("5.2 Fahrzeug einem Einsatz zuweisen")
    pdf.body(
        "Ziehen Sie ein freies Fahrzeug aus der Seitenleiste auf eine Einsatzkarte, "
        "um es diesem Einsatz zuzuweisen. Das Fahrzeug erscheint dann auf der Karte "
        "und wird aus der Liste freier Einheiten entfernt."
    )

    pdf.section_title("5.3 Fahrzeug umzuweisen")
    pdf.body(
        "Ziehen Sie den Fahrzeug-Chip direkt von einer Einsatzkarte auf eine andere Karte. "
        "Das Fahrzeug wird automatisch vom alten Einsatz abgemeldet und dem neuen zugewiesen."
    )

    pdf.section_title("5.4 Nächstgelegene Einheiten anzeigen")
    pdf.body(
        "Klicken Sie auf das Fahrzeug-Symbol auf einer Einsatzkarte. "
        "Die nächstgelegenen Einheiten werden in der Seitenleiste kurz hervorgehoben (pulsieren). "
        "Die zugehörigen Gruppen werden automatisch aufgeklappt."
    )

    pdf.section_title("5.5 Fahrzeugverfügbarkeit ändern")
    pdf.body("Sie können einzelne Fahrzeuge oder ganze Standorte als nicht verfügbar markieren:")
    pdf.bullet(
        "Einzelnes Fahrzeug: Klicken Sie auf den Verfügbarkeits-Schalter neben dem Fahrzeug. "
        "Sie können optional eine Dauer angeben (z.\u202fB. \u201e30\u201c für 30 Minuten, \u201e2h\u201c für 2 Stunden). "
        "Nach Ablauf wird das Fahrzeug automatisch wieder verfügbar."
    )
    pdf.bullet(
        "Ganzer Standort: Klicken Sie auf den Verfügbarkeits-Schalter neben dem Gruppennamen. "
        "Alle Fahrzeuge dieses Standorts werden auf nicht verfügbar gesetzt."
    )

    pdf.section_title("5.6 Neues Fahrzeug anlegen")
    pdf.body(
        "Über die entsprechende Schaltfläche können Sie ein neues Fahrzeug erfassen. "
        "Geben Sie Standort (Ort), Fahrzeugname und Mannschaftsstärke an."
    )

    # -- Suche & Filter --
    pdf.add_page()
    pdf.chapter_title("6. Suche und Filter")

    pdf.section_title("6.1 Textsuche")
    pdf.body(
        "Geben Sie im Suchfeld oben rechts einen Suchbegriff ein. "
        "Es werden alle Einsatzkarten durchsucht (Titel, Typ, Ort, Notizen). "
        "Nicht passende Karten werden ausgeblendet."
    )

    pdf.section_title("6.2 Abschnittsfilter")
    pdf.body(
        "Wählen Sie im Dropdown \u201eFilter Abschnitt\u201c einen bestimmten Abschnitt aus. "
        "Es werden dann nur Einsätze dieses Abschnitts angezeigt."
    )

    # -- Import & Export --
    pdf.add_page()
    pdf.chapter_title("7. Import und Export")

    pdf.section_title("7.1 Automatischer Import")
    pdf.body(
        "Das System kann Einsätze automatisch aus externen Quellen importieren. "
        "Der Status wird unten im Bereich der Aktualisierungszeit angezeigt "
        "(z.\u202fB. \u201ein 45s\u201c für den nächsten automatischen Import). "
        "Die Konfiguration erfolgt über das Admin-Panel."
    )

    pdf.section_title("7.2 Manueller Import")
    pdf.body(
        "Klicken Sie auf die Schaltfläche \u201eImport\u201c in der Werkzeugleiste, "
        "um sofort einen Import auszulösen, ohne auf den nächsten automatischen Zyklus zu warten."
    )

    pdf.section_title("7.3 PDF-Export")
    pdf.body(
        "Klicken Sie auf \u201ePDF\u201c in der Werkzeugleiste. Es wird ein PDF-Dokument mit "
        "der aktuellen Einsatzübersicht in einem neuen Fenster geöffnet."
    )

    pdf.section_title("7.4 CSV-Log")
    pdf.body(
        "Klicken Sie auf \u201eLog (CSV)\u201c, um eine CSV-Datei mit dem Protokoll aller "
        "Einsatzänderungen herunterzuladen."
    )

    # -- Karte --
    pdf.add_page()
    pdf.chapter_title("8. Kartenansicht")
    pdf.body(
        "In der Detailansicht eines Einsatzes wird eine Karte mit dem Einsatzort angezeigt. "
        "Die Karte bietet folgende Funktionen:"
    )
    pdf.bullet("Der aktuelle Einsatz wird als roter Pin dargestellt.")
    pdf.bullet("Andere aktive Einsätze werden als blaue Pins angezeigt.")
    pdf.bullet("Zugewiesene Fahrzeuge werden mit eigenen Symbolen dargestellt.")
    pdf.bullet(
        "GPS-getrackte Fahrzeuge werden automatisch aktualisiert (alle 5 Sekunden)."
    )
    pdf.bullet(
        "Nicht-GPS-Fahrzeuge können manuell auf der Karte positioniert werden (Drag & Drop)."
    )

    # -- Laufband / Ticker --
    pdf.chapter_title("9. Laufband (Ticker)")
    pdf.body(
        "Am oberen Bildschirmrand kann ein Laufband mit aktuellen Lagemeldungen angezeigt werden. "
        "Diese werden automatisch aus den Aufgaben der Rolle S2 (Lagemeldungen) übernommen "
        "und alle 30 Sekunden aktualisiert."
    )

    # -- Navigation --
    pdf.add_page()
    pdf.chapter_title("10. Navigation")
    pdf.body("Unten rechts auf dem Bildschirm finden Sie folgende Schaltflächen:")
    pdf.bullet("+-Button \u2013 Neuen Einsatz anlegen (nur mit Bearbeitungsrecht).")
    pdf.bullet("A-Button \u2013 Zum Aufgabenboard wechseln.")
    pdf.bullet("M-Button \u2013 Zur Meldestelle wechseln.")
    pdf.bullet("i-Button \u2013 Diese Hilfe öffnen.")
    pdf.bullet("Abmelde-Button \u2013 Vom System abmelden.")

    # -- Statusseite --
    pdf.chapter_title("11. Statusseite")
    pdf.body(
        "Unter /status ist eine kompakte, schreibgeschützte Übersicht verfügbar. "
        "Sie eignet sich für die Anzeige auf Monitoren und zeigt:"
    )
    pdf.bullet("Anzahl aktiver Einheiten und eingesetztes Personal.")
    pdf.bullet("Anzahl aktiver Einsätze und Gesamtzahl aller Einsätze.")
    pdf.bullet("Alle drei Spalten mit kompakten Einsatzkarten.")
    pdf.body("Die Statusseite aktualisiert sich automatisch alle 7 Sekunden.")

    # -- Speichern --
    path = os.path.join(OUT_DIR, "Hilfe.pdf")
    pdf.output(path)
    print(f"  \u2713 {path}")


# ======================================================================
#  AUFGABENBOARD
# ======================================================================
def generate_aufgabenboard():
    pdf = HilfePDF("EINFO \u2013 Hilfe Aufgabenboard")
    pdf.alias_nb_pages()

    # -- Deckblatt --
    pdf.cover_page("Aufgabenboard", "Hilfe und Bedienungsanleitung")

    # -- Übersicht --
    pdf.add_page()
    pdf.chapter_title("1. Übersicht")
    pdf.body(
        "Das Aufgabenboard dient der Verwaltung von Aufträgen und Aufgaben, "
        "die einzelnen Rollen im Stab zugewiesen werden. Es ist als Kanban-Board "
        "mit drei Spalten aufgebaut:"
    )
    pdf.bullet("Neu \u2013 Neu erstellte Aufgaben, die noch nicht begonnen wurden.")
    pdf.bullet("In Bearbeitung \u2013 Aufgaben, an denen aktuell gearbeitet wird.")
    pdf.bullet("Erledigt \u2013 Abgeschlossene Aufgaben.")
    pdf.body(
        "Jede Rolle (z.\u202fB. S1, S3, S4) hat ein eigenes Aufgabenboard. "
        "Die Aufgaben einer Rolle sind nur auf dem jeweiligen Board sichtbar."
    )

    # -- Rollen --
    pdf.add_page()
    pdf.chapter_title("2. Rollen und Berechtigungen")
    pdf.body(
        "Die Berechtigung auf dem Aufgabenboard hängt von Ihrer Rolle ab:"
    )
    pdf.role_table([
        ("Admin", "Systemadministrator", "Bearbeiten"),
        ("S2", "Lage und Information", "Bearbeiten"),
        ("LtStb", "Leiter Stab", "Bearbeiten"),
        ("MS", "Meldestelle", "Bearbeiten"),
        ("S1", "Personal", "Bearbeiten"),
        ("S3", "Einsatz / Operation", "Bearbeiten"),
        ("S4", "Versorgung / Logistik", "Bearbeiten"),
        ("S5", "Öffentlichkeitsarbeit", "Bearbeiten"),
        ("S6", "IT / Kommunikation", "Bearbeiten"),
        ("Mitarbeiter", "Allgemeiner Mitarbeiter", "Nur Ansicht"),
    ])

    pdf.section_title("Rollenspezifische Aufgaben")
    pdf.bullet(
        "LtStb (Leiter Stab): Kann zwischen allen Rollen-Boards wechseln und Aufgaben "
        "an andere Rollen delegieren. Hat die Gesamtübersicht über alle Aufgaben."
    )
    pdf.bullet(
        "S1 (Personal): Verwaltet Aufgaben rund um Personalplanung, "
        "Schichteinteilung und Personalübersichten."
    )
    pdf.bullet(
        "S2 (Lage): Erstellt Lagemeldungen und verwaltet Informationsaufgaben. "
        "Lagemeldungen von S2 erscheinen als Laufband auf dem Einsatzboard."
    )
    pdf.bullet(
        "S3 (Einsatz): Verwaltet operative Aufträge, koordiniert Einsatzmaßnahmen "
        "und erstellt Einsatzbefehle."
    )
    pdf.bullet(
        "S4 (Versorgung): Kümmert sich um logistische Aufgaben wie Verpflegung, "
        "Material und Betriebsmittel."
    )
    pdf.bullet(
        "S5 (Öffentlichkeitsarbeit): Verwaltet Aufgaben zur Medien- und "
        "Öffentlichkeitskommunikation."
    )
    pdf.bullet(
        "S6 (IT/Kommunikation): Aufgaben rund um Funkverbindungen, "
        "IT-Infrastruktur und Kommunikationstechnik."
    )
    pdf.bullet(
        "MS (Meldestelle): Kann Aufgaben anlegen, die aus Protokolleinträgen "
        "der Meldestelle entstehen."
    )

    pdf.section_title("Rollenwechsel")
    pdf.body(
        "Der Leiter Stab (LtStb) und sein Stellvertreter können über das "
        "Rollen-Dropdown oben links zwischen den Boards verschiedener Rollen wechseln. "
        "Andere Benutzer sehen nur ihr eigenes Board."
    )

    # -- Aufgabe anlegen --
    pdf.add_page()
    pdf.chapter_title("3. Eine neue Aufgabe anlegen")
    pdf.body(
        "Klicken Sie auf \u201eNeu\u201c in der Werkzeugleiste oder auf den +-Button unten rechts. "
        "Es öffnet sich ein Formular mit folgenden Feldern:"
    )
    pdf.bullet(
        "Frist / Kontrollzeitpunkt \u2013 Datum und Uhrzeit, bis wann die Aufgabe erledigt "
        "sein soll. Wird automatisch mit einem Standardwert vorbelegt."
    )
    pdf.bullet("Titel \u2013 Kurze, aussagekräftige Bezeichnung der Aufgabe (Pflichtfeld).")
    pdf.bullet("Typ \u2013 Kategorie der Aufgabe (z.\u202fB. Lagemeldung, Auftrag).")
    pdf.bullet("Verantwortlich (Rolle) \u2013 An welche Rolle sich die Aufgabe richtet.")
    pdf.bullet(
        "Einsatz verknüpfen \u2013 Optional: Verknüpft die Aufgabe mit einem bestehenden "
        "Einsatz aus dem Einsatzboard."
    )
    pdf.bullet("Notizen \u2013 Ausführliche Beschreibung oder zusätzliche Hinweise.")
    pdf.body(
        "Klicken Sie auf \u201eAnlegen\u201c, um die Aufgabe zu erstellen. "
        "Sie erscheint dann in der Spalte \u201eNeu\u201c."
    )

    # -- Aufgaben verwalten --
    pdf.add_page()
    pdf.chapter_title("4. Aufgaben verwalten")

    pdf.section_title("4.1 Status ändern per Drag & Drop")
    pdf.body(
        "Ziehen Sie eine Aufgabenkarte mit der Maus von einer Spalte in eine andere:"
    )
    pdf.bullet("Von \u201eNeu\u201c nach \u201eIn Bearbeitung\u201c \u2013 Die Aufgabe wird begonnen.")
    pdf.bullet(
        "Von \u201eIn Bearbeitung\u201c nach \u201eErledigt\u201c \u2013 Die Aufgabe wird abgeschlossen. "
        "Es erscheint eine Sicherheitsabfrage."
    )
    pdf.bullet("Innerhalb einer Spalte können Sie die Reihenfolge per Drag & Drop ändern.")

    pdf.section_title("4.2 Status ändern per Pfeil-Button")
    pdf.body(
        "Auf jeder Aufgabenkarte befindet sich ein Pfeil-Button (\u2192). "
        "Klicken Sie darauf, um die Aufgabe in die nächste Spalte zu verschieben."
    )

    pdf.section_title("4.3 Aufgabendetails anzeigen und bearbeiten")
    pdf.body(
        "Klicken Sie auf eine Aufgabenkarte, um die Detailansicht zu öffnen. "
        "Dort sehen Sie:"
    )
    pdf.bullet("Titel, Typ, Verantwortliche Rolle")
    pdf.bullet("Frist (Datum und Uhrzeit)")
    pdf.bullet("Beschreibung / Notizen")
    pdf.bullet("Verknüpfter Einsatz (falls vorhanden)")
    pdf.bullet("Verknüpfte Meldungen aus der Meldestelle")
    pdf.bullet("Herkunft der Aufgabe (z.\u202fB. aus Protokolleintrag erstellt)")
    pdf.body(
        "Klicken Sie auf \u201eBearbeiten\u201c, um die Felder zu ändern. "
        "Mit \u201eSpeichern\u201c übernehmen Sie die Änderungen."
    )

    # -- Meldungen --
    pdf.add_page()
    pdf.chapter_title("5. Verbindung zur Meldestelle")

    pdf.section_title("5.1 Meldung aus Aufgabe erstellen")
    pdf.body(
        "Klicken Sie in der Detailansicht einer Aufgabe auf \u201eMeldung\u201c. "
        "Es öffnet sich das Meldeformular der Meldestelle, vorausgefüllt mit den "
        "Informationen der Aufgabe. Nach dem Speichern wird die Meldung automatisch "
        "mit der Aufgabe verknüpft."
    )

    pdf.section_title("5.2 Verknüpfte Meldungen anzeigen")
    pdf.body(
        "In der Detailansicht sehen Sie unter \u201eVerknüpfte Meldungen\u201c alle "
        "Protokolleinträge, die mit dieser Aufgabe verbunden sind. "
        "Klicken Sie auf \u201eMeldung öffnen\u201c, um den jeweiligen Eintrag anzuzeigen."
    )

    pdf.section_title("5.3 Meldungen verknüpfen")
    pdf.body(
        "Im Bearbeitungsmodus können Sie über Häkchen weitere Protokolleinträge "
        "mit der Aufgabe verknüpfen. Es werden nur Meldungen angezeigt, bei denen "
        "die aktuelle Rolle als Empfänger eingetragen ist."
    )

    # -- Suche --
    pdf.add_page()
    pdf.chapter_title("6. Suche und Filterung")
    pdf.body(
        "Geben Sie im Suchfeld oben einen Suchbegriff ein. "
        "Es wird nach Titel, Typ, Verantwortlichkeit und Beschreibung gefiltert. "
        "Nicht passende Aufgaben werden sofort ausgeblendet."
    )

    # -- Aktualisierung --
    pdf.chapter_title("7. Aktualisierung")
    pdf.body(
        "Klicken Sie auf \u201eNeu laden\u201c, um die Aufgabenliste manuell zu aktualisieren. "
        "Die Daten werden auch automatisch in regelmäßigen Abständen geladen."
    )

    # -- Navigation --
    pdf.chapter_title("8. Navigation")
    pdf.body("Unten rechts auf dem Bildschirm finden Sie folgende Schaltflächen:")
    pdf.bullet("+-Button \u2013 Neue Aufgabe anlegen (nur mit Bearbeitungsrecht).")
    pdf.bullet("E-Button \u2013 Zum Einsatzboard wechseln.")
    pdf.bullet("M-Button \u2013 Zur Meldestelle wechseln.")
    pdf.bullet("i-Button \u2013 Diese Hilfe öffnen.")
    pdf.bullet("Abmelde-Button \u2013 Vom System abmelden.")

    # -- Speichern --
    path = os.path.join(OUT_DIR, "Hilfe_Aufgabenboard.pdf")
    pdf.output(path)
    print(f"  \u2713 {path}")


# ======================================================================
#  MELDESTELLE
# ======================================================================
def generate_meldestelle():
    pdf = HilfePDF("EINFO \u2013 Hilfe Meldestelle")
    pdf.alias_nb_pages()

    # -- Deckblatt --
    pdf.cover_page("Meldestelle", "Hilfe und Bedienungsanleitung")

    # -- Übersicht --
    pdf.add_page()
    pdf.chapter_title("1. Übersicht")
    pdf.body(
        "Die Meldestelle (auch Protokoll genannt) ist das zentrale Protokollierungs- "
        "und Kommunikationswerkzeug im Stab. Hier werden alle ein- und ausgehenden "
        "Meldungen, Aufträge und Lagemeldungen erfasst, verwaltet und archiviert."
    )
    pdf.body(
        "Die Meldestelle besteht aus zwei Bereichen: der Übersichtsliste aller "
        "Einträge und dem Formular zum Anlegen bzw. Bearbeiten einzelner Einträge."
    )

    # -- Rollen --
    pdf.add_page()
    pdf.chapter_title("2. Rollen und Berechtigungen")
    pdf.role_table([
        ("Admin", "Systemadministrator", "Bearbeiten"),
        ("S2", "Lage und Information", "Bearbeiten"),
        ("LtStb", "Leiter Stab", "Bearbeiten"),
        ("MS", "Meldestelle", "Bearbeiten"),
        ("TEST", "Testrolle", "Bearbeiten"),
        ("S1", "Personal", "Nur Ansicht"),
        ("S3", "Einsatz / Operation", "Nur Ansicht*"),
        ("S4", "Versorgung / Logistik", "Nur Ansicht"),
        ("S5", "Öffentlichkeitsarbeit", "Nur Ansicht"),
        ("S6", "IT / Kommunikation", "Nur Ansicht"),
        ("Mitarbeiter", "Allgemeiner Mitarbeiter", "Nur Ansicht"),
    ])
    pdf.body(
        "* S3 erhält Bearbeitungsrechte in der Meldestelle, wenn der Leiter Stab (LtStb) "
        "nicht angemeldet ist. Solange LtStb online ist, hat S3 nur Leserechte."
    )

    pdf.section_title("Aufgaben der Rollen in der Meldestelle")
    pdf.bullet(
        "MS (Meldestelle): Hauptverantwortlich für die Protokollführung. "
        "Erfasst alle ein- und ausgehenden Meldungen, leitet sie an die "
        "zuständigen Rollen weiter und überwacht die Erledigung."
    )
    pdf.bullet(
        "LtStb (Leiter Stab): Bestätigt Protokolleinträge und gibt Aufträge frei. "
        "Hat die Gesamtübersicht und kann alle Einträge bearbeiten."
    )
    pdf.bullet(
        "S2 (Lage): Erfasst Lagemeldungen und erstellt Lageberichte. "
        "Kann Einträge des Typs \u201eLage\u201c anlegen."
    )
    pdf.bullet(
        "S3 (Einsatz): Kann Einträge bestätigen, wenn LtStb nicht angemeldet ist. "
        "Bearbeitet operative Aufträge."
    )
    pdf.bullet(
        "S1, S4, S5, S6: Empfangen Meldungen über das Empfängerfeld und "
        "sehen die für sie relevanten Einträge."
    )

    # -- Übersicht --
    pdf.add_page()
    pdf.chapter_title("3. Übersichtsliste")
    pdf.body(
        "Die Übersicht zeigt alle Protokolleinträge in tabellarischer Form. "
        "Für jeden Eintrag sehen Sie:"
    )
    pdf.bullet("Protokoll-Nummer (fortlaufend)")
    pdf.bullet("Datum und Uhrzeit")
    pdf.bullet("Typ (Info, Auftrag oder Lage)")
    pdf.bullet("Betreff / Kurzbeschreibung")
    pdf.bullet("Empfänger (an welche Rollen der Eintrag gerichtet ist)")
    pdf.body(
        "Klicken Sie auf einen Eintrag, um ihn im Formular zu öffnen und zu bearbeiten."
    )

    pdf.section_title("3.1 Suche")
    pdf.body(
        "Nutzen Sie das Suchfeld oben, um nach Protokoll-Nummer, Betreff oder Inhalt zu suchen. "
        "Die Liste wird sofort gefiltert."
    )

    pdf.section_title("3.2 CSV-Export")
    pdf.body(
        "Klicken Sie auf \u201eCSV\u201c, um alle Protokolleinträge als CSV-Datei herunterzuladen. "
        "Die Datei kann in Tabellenkalkulationsprogrammen geöffnet werden."
    )

    # -- Eintrag anlegen --
    pdf.add_page()
    pdf.chapter_title("4. Neuen Eintrag anlegen")
    pdf.body(
        "Klicken Sie auf \u201e+ Eintrag anlegen\u201c oder den +-Button unten rechts. "
        "Das Formular öffnet sich mit folgenden Bereichen:"
    )

    pdf.section_title("4.1 Kopfbereich")
    pdf.bullet("Protokoll-Nr. \u2013 Wird automatisch vergeben.")
    pdf.bullet("ZU \u2013 Optionale Referenz auf einen anderen Protokolleintrag (Nummer).")

    pdf.section_title("4.2 Datum und Uhrzeit")
    pdf.bullet(
        "Datum \u2013 Geben Sie das Datum ein (Format: TT.MM.JJJJ). "
        "Kurzformate wie 101025 (= 10.10.2025) werden automatisch erkannt."
    )
    pdf.bullet(
        "Uhrzeit \u2013 Geben Sie die Uhrzeit ein (Format: HH:MM). "
        "Kurzformate wie 915 (= 09:15) werden akzeptiert."
    )

    pdf.section_title("4.3 Nachrichtentyp")
    pdf.body("Wählen Sie einen der folgenden Typen:")
    pdf.bullet("Info \u2013 Allgemeine Information")
    pdf.bullet("Auftrag \u2013 Ein konkreter Auftrag an eine oder mehrere Rollen")
    pdf.bullet("Lage \u2013 Lagemeldung / Lagebericht")

    pdf.section_title("4.4 Absender / Empfänger")
    pdf.bullet(
        "An/Von \u2013 Geben Sie den Namen ein. Wählen Sie die Richtung: \u201eAn\u201c (an jemanden) "
        "oder \u201eVon\u201c (von jemandem erhalten). Bereits verwendete Namen werden als "
        "Vorschläge angezeigt."
    )
    pdf.bullet("Kanal \u2013 Über welchen Kommunikationsweg (Funk, Telefon, E-Mail usw.).")

    pdf.section_title("4.5 Richtung")
    pdf.bullet("Eingang \u2013 Die Meldung wurde empfangen.")
    pdf.bullet("Ausgang \u2013 Die Meldung wurde gesendet.")

    pdf.section_title("4.6 Information / Auftrag")
    pdf.body(
        "Geben Sie im großen Textfeld den vollständigen Inhalt der Meldung oder "
        "des Auftrags ein."
    )

    pdf.section_title("4.7 Rückmeldung")
    pdf.body(
        "Optional können Sie eine erste Rückmeldung direkt erfassen."
    )

    # -- Empfänger --
    pdf.add_page()
    pdf.chapter_title("5. Empfänger festlegen")
    pdf.body(
        "Im Bereich \u201eergeht an\u201c legen Sie fest, an welche Rollen die Meldung gerichtet ist:"
    )
    pdf.bullet("\u201eAlle\u201c \u2013 Wählt alle Rollen gleichzeitig aus.")
    pdf.bullet("Einzelne Rollen: EL, LtStb, S1, S2, S3, S4, S5, S6")
    pdf.bullet(
        "Sonstiger Empfänger \u2013 Freitextfeld für Empfänger außerhalb des Stabs."
    )
    pdf.body("Mindestens ein Empfänger muss ausgewählt werden.")

    # -- Maßnahmen --
    pdf.chapter_title("6. Maßnahmen")
    pdf.body(
        "Im Bereich \u201eMaßnahmen\u201c können Sie bis zu 5 konkrete Handlungsanweisungen erfassen:"
    )
    pdf.bullet("Maßnahme \u2013 Beschreibung der durchzuführenden Aktion.")
    pdf.bullet(
        "Verantwortlich \u2013 Wer die Maßnahme durchführen soll. "
        "Bereits verwendete Namen werden als Vorschläge angezeigt."
    )
    pdf.bullet("Erledigt \u2013 Häkchen, wenn die Maßnahme abgeschlossen ist.")
    pdf.bullet(
        "Pfeil-Button (\u2192) \u2013 Erstellt aus der Maßnahme eine Aufgabe auf dem "
        "Aufgabenboard der verantwortlichen Rolle."
    )

    # -- Bestätigung --
    pdf.add_page()
    pdf.chapter_title("7. Bestätigung")
    pdf.body(
        "Protokolleinträge können durch berechtigte Rollen bestätigt werden. "
        "Setzen Sie dazu das Häkchen bei \u201ebestätigt\u201c. Die Bestätigung wird mit "
        "Rolle, Benutzername und Zeitstempel protokolliert."
    )
    pdf.body("Folgende Rollen können Einträge bestätigen:")
    pdf.bullet("LtStb (Leiter Stab)")
    pdf.bullet("Stellvertreter des Leiters Stab")
    pdf.bullet("S3 (nur wenn LtStb nicht angemeldet ist)")
    pdf.body(
        "Wichtig: Ausgehende Meldungen an externe Empfänger müssen bestätigt werden, "
        "bevor sie gedruckt werden können."
    )

    # -- Sperrung --
    pdf.chapter_title("8. Bearbeitungssperre")
    pdf.body(
        "Wenn ein anderer Benutzer einen Eintrag gerade bearbeitet, wird dieser "
        "für andere gesperrt. Sie sehen dann den Hinweis "
        "\u201eGerade in Bearbeitung durch [Benutzername]\u201c. "
        "Die Sperre wird automatisch aufgehoben, wenn der Benutzer die Bearbeitung beendet."
    )

    # -- Aktionen --
    pdf.add_page()
    pdf.chapter_title("9. Aktionen im Formular")

    pdf.section_title("9.1 Speichern")
    pdf.body(
        "Klicken Sie auf \u201eSpeichern\u201c, um den Eintrag zu sichern und zur Übersicht "
        "zurückzukehren. Tastenkombination: Strg+S."
    )

    pdf.section_title("9.2 Speichern und Neu")
    pdf.body(
        "Klicken Sie auf \u201eSpeichern/Neu\u201c, um den aktuellen Eintrag zu speichern und "
        "sofort ein leeres Formular für den nächsten Eintrag zu öffnen. "
        "Tastenkombination: Strg+Umschalt+S oder Strg+Eingabe."
    )

    pdf.section_title("9.3 Drucken")
    pdf.body(
        "Klicken Sie auf \u201eDrucken\u201c, um den Eintrag als PDF auszugeben. "
        "Für jeden Empfänger wird eine Kopie erstellt. "
        "Der Eintrag muss vorher gespeichert sein."
    )
    pdf.body(
        "Hinweis: Ausgehende Meldungen an externe Empfänger können erst nach "
        "Bestätigung gedruckt werden."
    )

    pdf.section_title("9.4 Abbrechen")
    pdf.body(
        "Klicken Sie auf \u201eAbbrechen\u201c oder drücken Sie ESC, um das Formular zu "
        "verlassen, ohne zu speichern."
    )

    # -- Aufgaben --
    pdf.add_page()
    pdf.chapter_title("10. Aufgaben aus Einträgen erstellen")
    pdf.body(
        "Aus Protokolleinträgen können direkt Aufgaben für das Aufgabenboard "
        "erstellt werden. Dies geschieht auf zwei Wegen:"
    )
    pdf.bullet(
        "Über den Pfeil-Button (\u2192) neben einer Maßnahme: Erstellt eine Aufgabe "
        "auf dem Board der verantwortlichen Rolle."
    )
    pdf.bullet(
        "Die Aufgabe wird automatisch mit dem Protokolleintrag verknüpft und "
        "kann im Aufgabenboard eingesehen werden."
    )

    # -- Navigation --
    pdf.chapter_title("11. Navigation")
    pdf.body("Unten rechts auf dem Bildschirm finden Sie folgende Schaltflächen:")
    pdf.bullet("+-Button \u2013 Neuen Protokolleintrag anlegen.")
    pdf.bullet("E-Button \u2013 Zum Einsatzboard wechseln.")
    pdf.bullet("A-Button \u2013 Zum Aufgabenboard wechseln.")
    pdf.bullet("i-Button \u2013 Diese Hilfe öffnen.")
    pdf.bullet("Abmelde-Button \u2013 Vom System abmelden.")
    pdf.body(
        "Zusätzlich öffnet die Schaltfläche \u201eÖffnen\u201c die Meldestelle in einem "
        "eigenen Fenster."
    )

    # -- Tastenkombinationen --
    pdf.chapter_title("12. Tastenkombinationen")
    pdf.bullet("Strg+S \u2013 Eintrag speichern")
    pdf.bullet("Strg+Umschalt+S oder Strg+Eingabe \u2013 Speichern und neuen Eintrag anlegen")
    pdf.bullet("ESC \u2013 Formular schließen / Abbrechen")

    # -- Speichern --
    path = os.path.join(OUT_DIR, "Hilfe_Meldestelle.pdf")
    pdf.output(path)
    print(f"  \u2713 {path}")


# ======================================================================
#  ADMIN-HANDBUCH
# ======================================================================
def generate_admin_help():
    pdf = HilfePDF("EINFO \u2013 Administratoren-Handbuch")
    pdf.alias_nb_pages()

    # -- Deckblatt --
    pdf.cover_page("Administratoren-Handbuch", "Konfiguration und Verwaltung")

    # ----------------------------------------------------------------
    # 1. Übersicht
    # ----------------------------------------------------------------
    pdf.add_page()
    pdf.chapter_title("1. \u00dcbersicht")
    pdf.body(
        "Das Admin-Panel ist die zentrale Verwaltungsoberfl\u00e4che von EINFO. "
        "Es ist ausschlie\u00dflich f\u00fcr Benutzer mit der Rolle \u201eAdmin\u201c zug\u00e4nglich "
        "und erreichbar unter /user-admin."
    )
    pdf.body("Im Admin-Panel k\u00f6nnen Sie folgende Bereiche konfigurieren:")
    pdf.bullet("Master-Key Verwaltung (Erststart und Entsperrung)")
    pdf.bullet("Rollen und Berechtigungen f\u00fcr alle drei Boards")
    pdf.bullet("Benutzerverwaltung (Anlegen, Bearbeiten, L\u00f6schen)")
    pdf.bullet("Import-Einstellungen (Auto-Import und Demomodus)")
    pdf.bullet("Auto-Druck f\u00fcr Protokolleintr\u00e4ge")
    pdf.bullet("KI-Analyse (Situationsanalyse mit optionalem RAG-Kontext)")
    pdf.bullet("Zeitgesteuerter Mailversand")
    pdf.bullet("Zeitgesteuerte API-Calls")
    pdf.bullet("Fetcher-Zugangsdaten")
    pdf.bullet("Chatbot & Worker-Steuerung")
    pdf.bullet("Knowledge-Basis (RAG) f\u00fcr den Chatbot")
    pdf.bullet("Hybrid-Filtersystem (Regeln R1\u2013R5)")
    pdf.bullet("KI-Modell-Verwaltung (Ollama)")

    # ----------------------------------------------------------------
    # 2. URLs
    # ----------------------------------------------------------------
    pdf.add_page()
    pdf.chapter_title("2. Wichtige URLs")
    pdf.body("Die folgenden Seiten sind \u00fcber den Browser erreichbar (Standard-Port: 4040):")
    pdf.bullet("/ \u2013 Einsatzboard (Hauptansicht)")
    pdf.bullet("/aufgaben \u2013 Aufgabenboard")
    pdf.bullet("/status \u2013 Statusseite (druckfreundlich mit ?print=1)")
    pdf.bullet("/user-login \u2013 Login-Seite")
    pdf.bullet("/user-admin \u2013 Admin-Panel")
    pdf.bullet("/user-firststart \u2013 Erststart-Assistent")
    pdf.bullet("/Hilfe.pdf \u2013 Benutzerhandbuch Einsatzboard")
    pdf.bullet("/Hilfe_Aufgabenboard.pdf \u2013 Benutzerhandbuch Aufgabenboard")
    pdf.bullet("/Hilfe_Meldestelle.pdf \u2013 Benutzerhandbuch Meldestelle")

    # ----------------------------------------------------------------
    # 3. Erststart & Master-Key
    # ----------------------------------------------------------------
    pdf.add_page()
    pdf.chapter_title("3. Erststart & Master-Key")

    pdf.section_title("3.1 Erststart")
    pdf.body(
        "Beim allerersten Start der Anwendung muss der Master-Key gesetzt und "
        "ein erster Admin-Benutzer angelegt werden. Navigieren Sie dazu zu /user-firststart."
    )
    pdf.bullet("Master-Key \u2013 W\u00e4hlen Sie ein sicheres Passwort als Master-Key.")
    pdf.bullet("Admin-Benutzer \u2013 Benutzername und Passwort f\u00fcr den ersten Administrator.")
    pdf.body(
        "Der Master-Key wird ben\u00f6tigt, um nach jedem Server-Neustart das System zu entsperren."
    )

    pdf.section_title("3.2 Master entsperren (nach Neustart)")
    pdf.body(
        "Nach einem Server-Neustart ist das System gesperrt (423 Master-Lock). "
        "Navigieren Sie zum Admin-Panel (/user-admin) und geben Sie den Master-Key "
        "im Bereich \u201eMaster entsperren\u201c ein. Erst danach k\u00f6nnen Benutzer und "
        "Rollen verwaltet werden."
    )

    pdf.section_title("3.3 Board zur\u00fccksetzen")
    pdf.body(
        "Im Admin-Panel steht oben rechts die Schaltfl\u00e4che \u201eReset\u201c zur Verf\u00fcgung. "
        "Damit wird das Einsatzboard komplett zur\u00fcckgesetzt. Es erscheint eine Sicherheitsabfrage. "
        "Verwenden Sie diese Funktion nur im Notfall oder f\u00fcr Testszenarien."
    )

    # ----------------------------------------------------------------
    # 4. Rollen und Berechtigungen
    # ----------------------------------------------------------------
    pdf.add_page()
    pdf.chapter_title("4. Rollen und Berechtigungen")

    pdf.section_title("4.1 Rollenkonzept")
    pdf.body(
        "Jede Rolle definiert die Zugriffsrechte auf die drei Boards: "
        "Einsatzboard, Aufgabenboard und Protokoll (Meldestelle). "
        "Pro Board gibt es drei Berechtigungsstufen:"
    )
    pdf.bullet("none \u2013 Kein Zugriff auf dieses Board.")
    pdf.bullet("view \u2013 Nur-Ansicht. Der Benutzer kann Daten sehen, aber nicht \u00e4ndern.")
    pdf.bullet("edit \u2013 Vollzugriff. Der Benutzer kann anlegen, bearbeiten und l\u00f6schen.")
    pdf.body(
        "Die Rolle \u201eAdmin\u201c hat immer \u201eedit\u201c auf allen Boards und kann nicht "
        "gel\u00f6scht oder eingeschr\u00e4nkt werden."
    )

    pdf.section_title("4.2 Standard-Rollen")
    pdf.role_table([
        ("Admin", "Systemadministrator", "edit auf allen Boards"),
        ("LtStb", "Leiter Stab", "edit auf allen Boards"),
        ("S1", "Personal", "view/edit je nach Config"),
        ("S2", "Lage und Information", "edit auf allen Boards"),
        ("S3", "Einsatz / Operation", "view/edit je nach Config"),
        ("S4", "Versorgung / Logistik", "view/edit je nach Config"),
        ("S5", "\u00d6ffentlichkeitsarbeit", "view/edit je nach Config"),
        ("S6", "IT / Kommunikation", "view/edit je nach Config"),
        ("MS", "Meldestelle", "edit auf Protokoll"),
        ("Mitarbeiter", "Allgemeiner Mitarbeiter", "view"),
    ])

    pdf.section_title("4.3 Rollen verwalten")
    pdf.body("Im Bereich \u201eRollen (Admin + weitere)\u201c k\u00f6nnen Sie:")
    pdf.bullet("Neue Rollen hinzuf\u00fcgen: Name eingeben und \u201eHinzuf\u00fcgen\u201c klicken.")
    pdf.bullet("Rollen entfernen: Auf das \u2715 neben dem Rollennamen klicken.")
    pdf.bullet(
        "Rechte pro Rolle: In der Tabelle \u201eRechte pro Rolle\u201c die Berechtigungsstufe "
        "(none/view/edit) f\u00fcr jedes Board per Dropdown einstellen."
    )
    pdf.bullet("Mit \u201eRollen speichern\u201c bzw. \u201eRechte speichern\u201c die \u00c4nderungen sichern.")

    # ----------------------------------------------------------------
    # 5. Benutzerverwaltung
    # ----------------------------------------------------------------
    pdf.add_page()
    pdf.chapter_title("5. Benutzerverwaltung")

    pdf.section_title("5.1 Benutzer anlegen")
    pdf.body("Geben Sie im Formular folgende Felder ein:")
    pdf.bullet("Username \u2013 Eindeutiger Benutzername zum Einloggen.")
    pdf.bullet("Passwort \u2013 Initiales Passwort f\u00fcr den Benutzer.")
    pdf.bullet("Anzeigename \u2013 Wird in der Oberfl\u00e4che angezeigt.")
    pdf.bullet(
        "Rollen \u2013 W\u00e4hlen Sie eine oder mehrere Rollen aus der Liste. "
        "Mehrfachauswahl \u00fcber Strg (Windows) oder \u2318 (macOS)."
    )

    pdf.section_title("5.2 Benutzer bearbeiten")
    pdf.body(
        "Klicken Sie auf \u201eEdit\u201c neben einem Benutzer, um Anzeigename, Rollen oder "
        "Passwort zu \u00e4ndern. Das Passwort wird nur aktualisiert, wenn ein neues "
        "eingegeben wird. Speichern Sie mit \u201eSave\u201c oder brechen Sie mit \u201eCancel\u201c ab."
    )

    pdf.section_title("5.3 Benutzer l\u00f6schen")
    pdf.body(
        "Klicken Sie auf \u201eDel\u201c neben einem Benutzer. Es erscheint eine Sicherheitsabfrage. "
        "Gel\u00f6schte Benutzer k\u00f6nnen nicht wiederhergestellt werden."
    )

    # ----------------------------------------------------------------
    # 6. Speicherorte
    # ----------------------------------------------------------------
    pdf.add_page()
    pdf.chapter_title("6. Relevante Speicherorte")
    pdf.body("Alle persistenten Daten liegen unter server/data/:")
    pdf.bullet("Aufg_board_<ROLLE>.json \u2013 Board-Daten pro Rolle (z.\u202fB. Aufg_board_S2.json)")
    pdf.bullet("Aufg_log.csv \u2013 Globales Aufgaben-Log")
    pdf.bullet("Aufg_log_<ROLLE>.csv \u2013 Rollenbezogene Logs")
    pdf.bullet("User_roles.json \u2013 Rollendefinitionen und Berechtigungen")
    pdf.bullet("User_users.enc.json \u2013 Verschl\u00fcsselte Benutzerdaten")
    pdf.bullet("User_authIndex.json \u2013 Login-Index")
    pdf.bullet("User_master.json \u2013 Master-Key Information")
    pdf.bullet("protocol.json / protocol.csv \u2013 Protokolldaten")
    pdf.bullet("prints/protokoll_*.pdf \u2013 Gedruckte Protokolle")
    pdf.bullet("conf/filtering_rules.json \u2013 Filterregel-Definitionen (R1\u2013R5)")
    pdf.bullet("conf/ai-analysis.json \u2013 KI-Analyse-Konfiguration")
    pdf.bullet("llm_feedback/learned_filters.json \u2013 Gelernte Filtergewichte")
    pdf.bullet("scenario_config.json \u2013 Szenario-Konfiguration")
    pdf.body("Der Frontend-Build (inkl. Hilfe-PDFs) liegt unter server/dist/.")

    # ----------------------------------------------------------------
    # 7. Import-Einstellungen
    # ----------------------------------------------------------------
    pdf.add_page()
    pdf.chapter_title("7. Import-Einstellungen")

    pdf.section_title("7.1 Auto-Import")
    pdf.body(
        "Der Auto-Import ruft in konfigurierbaren Intervallen externe Einsatzdaten ab. "
        "Im Admin-Panel k\u00f6nnen Sie folgende Parameter einstellen:"
    )
    pdf.bullet("Aktiviert/Deaktiviert \u2013 Schaltet den automatischen Import ein oder aus.")
    pdf.bullet(
        "Intervall (Sekunden) \u2013 Abstand zwischen zwei Import-Zyklen. "
        "Minimum: 5 Sekunden, Maximum: 3600 Sekunden (1 Stunde)."
    )
    pdf.bullet(
        "Demomodus \u2013 Wenn aktiviert, wird der Fetcher beim Import nicht gestartet. "
        "N\u00fctzlich f\u00fcr Tests oder Pr\u00e4sentationen mit statischen Daten."
    )

    pdf.section_title("7.2 Fetcher-Zugangsdaten")
    pdf.body(
        "Im Bereich \u201eFetcher-Zugangsdaten (global)\u201c k\u00f6nnen die Zugangsdaten "
        "f\u00fcr externe Datenquellen hinterlegt werden. Diese werden vom Import-Modul "
        "verwendet, um Einsatzdaten abzurufen."
    )

    # ----------------------------------------------------------------
    # 8. Auto-Druck (Protokoll)
    # ----------------------------------------------------------------
    pdf.add_page()
    pdf.chapter_title("8. Auto-Druck (Protokoll)")
    pdf.body(
        "Der Auto-Druck generiert in regelm\u00e4\u00dfigen Abst\u00e4nden automatisch "
        "PDF-Ausdrucke der Protokolleintr\u00e4ge. Die Konfiguration umfasst:"
    )
    pdf.bullet("Aktiviert/Deaktiviert \u2013 Schaltet den automatischen Druck ein oder aus.")
    pdf.bullet(
        "Intervall (Minuten) \u2013 Zeitabstand zwischen zwei Druckl\u00e4ufen. "
        "Minimum: 1 Minute."
    )
    pdf.bullet(
        "Umfang (Scope) \u2013 Bestimmt, welche Eintr\u00e4ge gedruckt werden:\n"
        "  \u2022 \u201eIntervall\u201c \u2013 Nur Eintr\u00e4ge seit dem letzten Drucklauf.\n"
        "  \u2022 \u201eAlle\u201c \u2013 Alle vorhandenen Protokolleintr\u00e4ge."
    )
    pdf.body(
        "Der Zeitpunkt des letzten Drucklaufs wird im Admin-Panel angezeigt. "
        "Gedruckte PDFs werden unter server/data/prints/ abgelegt."
    )

    # ----------------------------------------------------------------
    # 9. KI-Analyse
    # ----------------------------------------------------------------
    pdf.add_page()
    pdf.chapter_title("9. KI-Analyse (Situationsanalyse)")
    pdf.body(
        "Die KI-Analyse erstellt in regelm\u00e4\u00dfigen Abst\u00e4nden eine automatische "
        "Situationseinsch\u00e4tzung auf Basis der aktuellen Einsatz- und Protokolldaten."
    )
    pdf.bullet("Aktiviert/Deaktiviert \u2013 Schaltet die automatische Analyse ein oder aus.")
    pdf.bullet(
        "Intervall (Minuten) \u2013 Zeitabstand zwischen zwei Analysel\u00e4ufen. "
        "Wert 0 bedeutet: nur manuelle Ausl\u00f6sung."
    )
    pdf.bullet(
        "RAG-Kontext verwenden \u2013 Wenn aktiviert, werden zus\u00e4tzlich Informationen "
        "aus der Knowledge-Basis (Wissensdatenbank) in die Analyse einbezogen. "
        "Dies kann die Qualit\u00e4t der Einsch\u00e4tzung verbessern, erh\u00f6ht aber die "
        "Verarbeitungszeit."
    )

    # ----------------------------------------------------------------
    # 10. Mail-Zeitpl\u00e4ne
    # ----------------------------------------------------------------
    pdf.add_page()
    pdf.chapter_title("10. Zeitgesteuerter Mailversand")
    pdf.body(
        "Im Bereich \u201eZeitgesteuerter Mailversand\u201c k\u00f6nnen Sie wiederkehrende "
        "E-Mail-Versandauftr\u00e4ge konfigurieren. Jeder Zeitplan hat folgende Felder:"
    )
    pdf.bullet("Bezeichnung \u2013 Interner Name f\u00fcr den Zeitplan.")
    pdf.bullet("Empf\u00e4nger (An) \u2013 E-Mail-Adresse(n) der Empf\u00e4nger.")
    pdf.bullet("Betreff \u2013 Betreffzeile der E-Mail.")
    pdf.bullet("Text \u2013 Nachrichteninhalt.")
    pdf.bullet("Anhang-Pfad \u2013 Optionaler Dateipfad f\u00fcr einen Anhang.")
    pdf.bullet(
        "Modus \u2013 \u201eIntervall\u201c (alle X Minuten) oder \u201eFeste Uhrzeit\u201c (t\u00e4glich zu einer bestimmten Uhrzeit)."
    )
    pdf.bullet("Aktiviert \u2013 Ob der Zeitplan aktiv ist.")
    pdf.body(
        "Bestehende Zeitpl\u00e4ne k\u00f6nnen bearbeitet, gel\u00f6scht oder der letzte "
        "Versandzeitpunkt zur\u00fcckgesetzt werden."
    )

    # ----------------------------------------------------------------
    # 11. API-Zeitpl\u00e4ne
    # ----------------------------------------------------------------
    pdf.add_page()
    pdf.chapter_title("11. Zeitgesteuerte API-Calls")
    pdf.body(
        "Im Bereich \u201eZeitgesteuerte API-Calls\u201c k\u00f6nnen automatische HTTP-Anfragen "
        "an externe Systeme konfiguriert werden. Jeder Zeitplan umfasst:"
    )
    pdf.bullet("Bezeichnung \u2013 Interner Name f\u00fcr den Zeitplan.")
    pdf.bullet("URL \u2013 Ziel-URL f\u00fcr den HTTP-Aufruf.")
    pdf.bullet("Methode \u2013 HTTP-Methode (GET, POST, PUT, DELETE).")
    pdf.bullet("Body \u2013 Optionaler Request-Body (f\u00fcr POST/PUT).")
    pdf.bullet(
        "Modus \u2013 \u201eIntervall\u201c (alle X Minuten) oder \u201eFeste Uhrzeit\u201c (t\u00e4glich)."
    )
    pdf.bullet("Aktiviert \u2013 Ob der Zeitplan aktiv ist.")
    pdf.body(
        "Zeitpl\u00e4ne k\u00f6nnen bearbeitet, gel\u00f6scht oder der letzte "
        "Aufrufzeitpunkt zur\u00fcckgesetzt werden."
    )

    # ----------------------------------------------------------------
    # 12. Chatbot & Worker
    # ----------------------------------------------------------------
    pdf.add_page()
    pdf.chapter_title("12. Chatbot & Worker")

    pdf.section_title("12.1 Chatbot-Steuerung")
    pdf.body(
        "Der EINFO-Chatbot basiert auf einem lokalen LLM (Llama 3.1) und nutzt "
        "RAG (Retrieval-Augmented Generation) f\u00fcr kontextbezogene Antworten. "
        "Im Admin-Panel k\u00f6nnen Sie den Chatbot starten und stoppen. "
        "Der aktuelle Status (Running/Stopped) wird automatisch alle 5 Sekunden aktualisiert."
    )

    pdf.section_title("12.2 Worker-Steuerung")
    pdf.body(
        "Der Worker ist ein Hintergrundprozess, der regelm\u00e4\u00dfig Aufgaben wie "
        "Datenaufbereitung, Analyse und Synchronisation durchf\u00fchrt. "
        "Sie k\u00f6nnen den Worker starten und stoppen."
    )

    pdf.section_title("12.3 Worker-Intervall")
    pdf.body(
        "Im Bereich \u201eWorker-Intervall Einstellung\u201c legen Sie fest, wie oft der Worker "
        "seine Aufgaben ausf\u00fchrt. Das Intervall wird in Sekunden angegeben "
        "(Minimum: 5 Sekunden). Zus\u00e4tzlich kann der Worker hier aktiviert oder "
        "deaktiviert werden."
    )

    # ----------------------------------------------------------------
    # 13. Knowledge-Basis (RAG)
    # ----------------------------------------------------------------
    pdf.add_page()
    pdf.chapter_title("13. Knowledge-Basis (RAG)")
    pdf.body(
        "Die Knowledge-Basis enth\u00e4lt Dokumente, die der Chatbot als Wissensquelle "
        "nutzt. Neue Dateien (PDF, JSON, TXT) k\u00f6nnen hochgeladen werden."
    )
    pdf.bullet(
        "Dateien hochladen \u2013 W\u00e4hlen Sie eine oder mehrere Dateien \u00fcber den "
        "Upload-Button aus."
    )
    pdf.bullet(
        "Dateien anzeigen \u2013 Die Liste zeigt alle vorhandenen Dateien in der "
        "Knowledge-Basis mit Dateiname und Gr\u00f6\u00dfe."
    )
    pdf.bullet(
        "Dateien l\u00f6schen \u2013 Einzelne Dateien k\u00f6nnen aus der Knowledge-Basis "
        "entfernt werden."
    )
    pdf.bullet(
        "Ingest starten \u2013 Nach dem Hochladen neuer Dateien muss ein Ingest "
        "(Indizierung) gestartet werden, damit die Inhalte im RAG-System "
        "verf\u00fcgbar werden. Dieser Vorgang kann einige Minuten dauern."
    )

    # ----------------------------------------------------------------
    # 14. Hybrid-Filtersystem
    # ----------------------------------------------------------------
    pdf.add_page()
    pdf.chapter_title("14. Hybrid-Filtersystem (R1\u2013R5)")
    pdf.body(
        "Das Filtersystem besteht aus f\u00fcnf konfigurierbaren Regeln, die steuern, "
        "welche Daten dem Chatbot als Kontext bereitgestellt werden. "
        "Die Regeln k\u00f6nnen einzeln aktiviert oder deaktiviert werden."
    )

    pdf.section_title("R1 \u2013 Abschnitte-Priorit\u00e4t")
    pdf.body(
        "Filtert Abschnitte nach Priorit\u00e4t und zeigt die wichtigsten. "
        "Ber\u00fccksichtigt kritische Eins\u00e4tze, Gesamtzahl der Eins\u00e4tze, "
        "Personalst\u00e4rke und durchschnittlichen Personaleinsatz pro Einsatz."
    )

    pdf.section_title("R2 \u2013 Protokoll-Relevanz")
    pdf.body(
        "Filtert Protokoll-Eintr\u00e4ge nach Relevanz. Bewertet Eintr\u00e4ge anhand "
        "konfigurierbarer Faktoren wie offene Fragen, Ressourcen-Anfragen, "
        "Statusmeldungen, Dringlichkeit und Warnungen. Einige Faktoren sind "
        "\u201elernbar\u201c und passen ihre Gewichtung automatisch an."
    )

    pdf.section_title("R3 \u2013 Trend-Erkennung")
    pdf.body(
        "Erkennt Trends in der Einsatzentwicklung \u00fcber konfigurierbare "
        "Zeitfenster (Standard: 60 und 120 Minuten). Erstellt Prognosen "
        "f\u00fcr den zuk\u00fcnftigen Einsatzverlauf."
    )

    pdf.section_title("R4 \u2013 Ressourcen-Status")
    pdf.body(
        "Analysiert den Ressourcen-Status und erkennt Engp\u00e4sse. "
        "Hebt Bereiche mit hoher Auslastung hervor (Standard-Schwelle: 80%)."
    )

    pdf.section_title("R5 \u2013 Stabs-Fokus")
    pdf.body(
        "Aggregiert Daten f\u00fcr die Stabs-Ansicht. Zeigt nur kritische "
        "Einzeleins\u00e4tze (z.\u202fB. Personen in Gefahr, Evakuierungen, "
        "kritische Infrastruktur). Die Scoring-Faktoren und Schwellenwerte "
        "sind im Admin-Panel konfigurierbar."
    )

    pdf.section_title("Gelernte Filter")
    pdf.body(
        "Das System lernt aus Benutzer-Feedback automatisch, welche "
        "Filterkriterien hilfreich waren. Die gelernten Gewichte k\u00f6nnen "
        "im Admin-Panel eingesehen und bei Bedarf zur\u00fcckgesetzt werden."
    )

    # ----------------------------------------------------------------
    # 15. KI-Modell-Verwaltung
    # ----------------------------------------------------------------
    pdf.add_page()
    pdf.chapter_title("15. KI-Modell-Verwaltung")
    pdf.body(
        "Im Bereich \u201eKI-Modell-Verwaltung\u201c werden die lokal verf\u00fcgbaren "
        "LLM-Modelle (via Ollama) verwaltet. Sie k\u00f6nnen:"
    )
    pdf.bullet("Verf\u00fcgbare Modelle auflisten und deren Status einsehen.")
    pdf.bullet("Neue Modelle herunterladen (Pull).")
    pdf.bullet("Das aktive Modell f\u00fcr den Chatbot und die Analyse ausw\u00e4hlen.")

    # ----------------------------------------------------------------
    # 16. Konfiguration (.env) -- Vollstaendige Referenz
    # ----------------------------------------------------------------
    pdf.add_page()
    pdf.chapter_title("16. Konfiguration (.env)")
    pdf.body(
        "Alle Umgebungsvariablen werden in der Datei server/dot.env (bzw. .env) "
        "konfiguriert. Nach Aenderungen muss der Server neu gestartet werden. "
        "Im Folgenden sind alle verfuegbaren Parameter dokumentiert."
    )

    # -- 16.1 Server-Grundkonfiguration --
    pdf.section_title("16.1 Server-Grundkonfiguration")
    pdf.bullet("PORT \u2013 HTTP-Port des Hauptservers (Standard: 4040).")
    pdf.bullet(
        "DATA_DIR \u2013 Basisverzeichnis fuer persistente Daten "
        "(Einsatzlisten, Sessions, Druckausgaben)."
    )
    pdf.bullet("PUBLIC_DIR \u2013 Optionales Verzeichnis fuer statische WMS-Dateien.")
    pdf.bullet(
        "KANBAN_LOG_DIR \u2013 Optionales Log-Verzeichnis "
        "(logs/Log.txt, WMS_TILES.log)."
    )
    pdf.bullet(
        "KANBAN_COOKIE_SECURE \u2013 Auf \"1\" setzen, um sichere Cookies "
        "fuer Board-Login zu erzwingen (HTTPS erforderlich)."
    )

    # -- 16.2 Frontend-Polling --
    pdf.section_title("16.2 Frontend-Polling")
    pdf.bullet(
        "UI_STATUS_POLL_INTERVAL_MS \u2013 Polling-Intervall (ms) fuer "
        "/api/ff/status und /api/ff/creds."
    )
    pdf.bullet(
        "UI_ACTIVITY_POLL_INTERVAL_MS \u2013 Polling-Intervall (ms) fuer "
        "/api/activity/status."
    )

    # -- 16.3 Cache --
    pdf.section_title("16.3 Cache-Konfiguration")
    pdf.bullet(
        "BOARD_CACHE_MAX_AGE_MS \u2013 Maximale Cache-Dauer fuer berechnete "
        "Board-Daten in Millisekunden."
    )
    pdf.bullet(
        "VEHICLE_CACHE_TTL_MS \u2013 Lebensdauer des Fahrzeug-Caches "
        "bevor er neu geladen wird (ms)."
    )

    # -- 16.4 Feuerwehr-Feed --
    pdf.add_page()
    pdf.section_title("16.4 Feuerwehr-Feed (Fetcher)")
    pdf.bullet("FF_OUT_FILE \u2013 Ausgabedatei fuer den gefilterten Feed (JSON-Format).")
    pdf.bullet("FF_GPS_OUT_FILE \u2013 Ausgabedatei fuer Fahrzeug-GPS-Informationen.")
    pdf.bullet(
        "FF_POLL_INTERVAL_MS \u2013 Poll-Intervall fuer den Feed "
        "(Standard: 60000 ms = 1 Minute)."
    )
    pdf.bullet(
        "FF_ACTIVITY_SWEEP_INTERVAL_MS \u2013 Intervall fuer die "
        "Aktivitaetsueberwachung (ms)."
    )
    pdf.bullet(
        "FF_DEBUG \u2013 Auf \"1\" setzen fuer detailliertes Fetcher-Logging "
        "(HTTP-Status, Parsing-Infos)."
    )
    pdf.bullet(
        "FF_LIST_PATH \u2013 Pfadsegment fuer den Einsatzlisten-Endpunkt "
        "(Standard: \"/list\")."
    )
    pdf.bullet(
        "FF_LIST_EXTRA \u2013 Zusaetzliche Query-Parameter fuer den "
        "Einsatzlisten-Endpunkt."
    )
    pdf.bullet(
        "FF_LIST_TIMEOUT_MIN \u2013 Maximales Timeout in Minuten, bevor "
        "der Feed als veraltet markiert wird (Standard: 2880)."
    )
    pdf.bullet(
        "FF_GPS_PATH \u2013 Pfadsegment fuer den Fahrzeug-GPS-Endpunkt "
        "(Standard: \"/status/gps\")."
    )
    pdf.bullet(
        "FF_ONCE \u2013 \"1\" fuer einmaligen Abruf (Debug/Test), "
        "\"0\" fuer Dauerbetrieb."
    )
    pdf.bullet(
        "FF_CA_FILE \u2013 Optionaler Pfad zur TLS-Zertifikatskette "
        "fuer HTTPS-Verbindungen."
    )
    pdf.bullet(
        "FF_LOCK_FILE \u2013 Optionaler Pfad zur Lock-Datei, um "
        "parallele Fetcher-Instanzen zu verhindern."
    )
    pdf.bullet(
        "FF_AUTO_STOP_MIN \u2013 Minuten bis zur automatischen Abschaltung "
        "eines Einsatzes ohne neue Ereignisse (optional)."
    )
    pdf.bullet(
        "FF_USERNAME \u2013 Optionaler HTTP-Basic-Auth-Benutzername "
        "fuer den Feed-Zugriff."
    )
    pdf.bullet(
        "FF_PASSWORD \u2013 Optionales Passwort / API-Secret "
        "fuer den Feed-Zugriff."
    )
    pdf.bullet(
        "FF_LOGIN_MAX_RETRIES \u2013 Maximale Login-Wiederholungen "
        "(Standard: 3)."
    )
    pdf.bullet(
        "FF_LOGIN_RETRY_DELAY_MS \u2013 Verzoegerung zwischen Login-Versuchen "
        "in ms (Standard: 5000)."
    )

    # -- 16.5 Naehe-Suche --
    pdf.section_title("16.5 Naehe-Suche (Nearby)")
    pdf.bullet("NEARBY_RADIUS_KM \u2013 Standard-Suchradius in km (Standard: 10).")
    pdf.bullet("NEARBY_RADIUS_MIN_KM \u2013 Minimaler Radius in km (Standard: 0.1).")
    pdf.bullet("NEARBY_RADIUS_MAX_KM \u2013 Maximaler Radius in km (Standard: 50).")

    # -- 16.6 WMS/Karte --
    pdf.add_page()
    pdf.section_title("16.6 WMS / Karten-Konfiguration")
    pdf.bullet("WMS_PORT \u2013 Port des WMS-Dienstes (Standard: 8090).")
    pdf.bullet("WMS_TITLE \u2013 Titel fuer die WMS-Capabilities-Metadaten.")
    pdf.bullet("WMS_ABSTRACT \u2013 Beschreibung fuer WMS-Metadaten.")
    pdf.bullet(
        "WMS_LABELS \u2013 \"1\" zeigt Kartenbeschriftungen, "
        "\"0\" nur Symbole."
    )
    pdf.bullet(
        "WMS_LABEL_FONT \u2013 CSS-Fontangabe fuer Beschriftungen "
        "(Standard: \"12px Sans-Serif\")."
    )
    pdf.bullet(
        "WMS_LABEL_COLOR \u2013 Hex-Farbe fuer Beschriftungstext "
        "(Standard: \"#000000\")."
    )
    pdf.bullet(
        "WMS_LABEL_OUTLINE \u2013 Hex-Farbe fuer Beschriftungsumriss "
        "(Standard: \"#ffffff\")."
    )
    pdf.bullet(
        "WMS_LABEL_OUTLINE_W \u2013 Breite des Umriss-Strichs in Pixeln "
        "(Standard: 3)."
    )
    pdf.bullet(
        "WMS_LABEL_TRIM \u2013 Maximale Textlaenge bevor abgeschnitten wird "
        "(Standard: 28)."
    )
    pdf.bullet("WMS_DEBUG \u2013 \"1\" aktiviert WMS-Debug-Logging.")

    # -- 16.7 Drucken --
    pdf.section_title("16.7 Druck-Konfiguration")
    pdf.bullet("KANBAN_MELDUNG_PRINT_DIR \u2013 Ausgabeverzeichnis fuer Meldungsdrucke.")
    pdf.bullet("KANBAN_EINSATZ_PRINT_DIR \u2013 Ausgabeverzeichnis fuer Einsatzdrucke.")
    pdf.bullet("KANBAN_PROTOKOLL_PRINT_DIR \u2013 Ausgabeverzeichnis fuer Protokolldrucke.")
    pdf.bullet("KANBAN_PRINT_COMMAND \u2013 Druckbefehl (Standard: \"lp\").")
    pdf.bullet("KANBAN_PRINT_OUTPUT_DIR \u2013 Explizites Druckausgabeverzeichnis.")
    pdf.bullet("PRINT_BASE_DIR \u2013 Basisverzeichnis fuer Druckausgaben.")
    pdf.bullet(
        "PUPPETEER_EXECUTABLE_PATH \u2013 Benutzerdefinierter Pfad "
        "zur Chrome/Chromium-Binary fuer die PDF-Erzeugung."
    )

    # -- 16.8 Benutzer-Sessions --
    pdf.add_page()
    pdf.section_title("16.8 Benutzer-Sessions & Online-Status")
    pdf.bullet(
        "USER_SESSION_IDLE_TIMEOUT_MIN \u2013 Inaktivitaets-Timeout "
        "in Minuten (Standard: 15)."
    )
    pdf.bullet(
        "USER_SESSION_IDLE_TIMEOUT_MS \u2013 Timeout in Millisekunden "
        "(Standard: 900000)."
    )
    pdf.bullet(
        "USER_SESSION_SWEEP_INTERVAL_MS \u2013 Intervall fuer die "
        "Bereinigung inaktiver Sessions in ms (Standard: 60000)."
    )

    # -- 16.9 Aufgaben / Frist --
    pdf.section_title("16.9 Aufgaben / Frist-Konfiguration")
    pdf.bullet(
        "DEFAULT_DUE_OFFSET_MINUTES \u2013 Standard-Vorlaufzeit fuer "
        "Aufgabenfristen in Minuten (Standard: 10)."
    )
    pdf.bullet(
        "TASK_DEFAULT_DUE_OFFSET_MINUTES \u2013 Alias fuer obigen Wert."
    )
    pdf.bullet(
        "AUFG_DEFAULT_DUE_MINUTES \u2013 Deutscher Alias fuer obigen Wert."
    )

    # -- 16.10 Auto-Import --
    pdf.section_title("16.10 Auto-Import & Auto-Druck")
    pdf.bullet(
        "AUTO_IMPORT_DEFAULT_INTERVAL_SEC \u2013 Standard-Auto-Import-Intervall "
        "in Sekunden (Standard: 30)."
    )
    pdf.bullet(
        "AUTO_PRINT_DEFAULT_INTERVAL_MINUTES \u2013 Standard-Auto-Druck-Intervall "
        "in Minuten (Standard: 10)."
    )
    pdf.bullet(
        "AUTO_PRINT_MIN_INTERVAL_MINUTES \u2013 Minimales Auto-Druck-Intervall "
        "in Minuten (Standard: 1)."
    )

    # -- 16.11 SMTP Mail --
    pdf.add_page()
    pdf.section_title("16.11 Mail / SMTP-Konfiguration")
    pdf.bullet("MAIL_HOST \u2013 SMTP-Server-Hostname.")
    pdf.bullet(
        "MAIL_PORT \u2013 SMTP-Port (Standard: 587 fuer STARTTLS, "
        "465 fuer SMTPS, 25 fuer unverschluesselt)."
    )
    pdf.bullet(
        "MAIL_SECURE \u2013 \"1\" fuer SMTPS (TLS ab Verbindungsstart), "
        "\"0\" fuer STARTTLS."
    )
    pdf.bullet(
        "MAIL_STARTTLS \u2013 \"1\" um STARTTLS nach dem Verbindungsaufbau "
        "anzufordern."
    )
    pdf.bullet("MAIL_USER / MAIL_USERNAME \u2013 SMTP-Benutzername.")
    pdf.bullet("MAIL_PASSWORD / MAIL_PASS \u2013 SMTP-Passwort.")
    pdf.bullet("MAIL_FROM \u2013 Absender-E-Mail-Adresse.")
    pdf.bullet("MAIL_REPLY_TO \u2013 Antwortadresse (Reply-To).")
    pdf.bullet(
        "MAIL_ALLOWED_FROM \u2013 Kommagetrennte Liste erlaubter "
        "Absenderadressen."
    )
    pdf.bullet(
        "MAIL_TIMEOUT_MS \u2013 SMTP-Befehls-Timeout in ms (Standard: 15000)."
    )
    pdf.bullet(
        "MAIL_TLS_REJECT_UNAUTHORIZED \u2013 \"1\" um selbstsignierte "
        "Zertifikate abzulehnen."
    )
    pdf.bullet("MAIL_CLIENT_ID \u2013 EHLO/HELO-Kennung.")
    pdf.bullet("MAIL_LOG \u2013 \"1\" aktiviert detailliertes Mail-Logging.")
    pdf.bullet(
        "MAIL_DELETE_AFTER_READ \u2013 \"1\" um Mails nach Verarbeitung "
        "zu loeschen (Standard: 1)."
    )
    pdf.bullet("MAIL_INBOX_DIR \u2013 Benutzerdefinierter Inbox-Verzeichnispfad.")
    pdf.bullet(
        "MAIL_INBOX_POLL_INTERVAL_SEC \u2013 Mail-Prueflintervall "
        "in Sekunden."
    )

    # -- 16.12 IMAP --
    pdf.section_title("16.12 IMAP-Konfiguration")
    pdf.bullet("MAIL_IMAP_HOST \u2013 IMAP-Server-Hostname.")
    pdf.bullet(
        "MAIL_IMAP_PORT \u2013 IMAP-Port (Standard: 993 fuer TLS, "
        "143 fuer Klartext/StartTLS)."
    )
    pdf.bullet(
        "MAIL_IMAP_SECURE \u2013 \"1\" fuer TLS ab Verbindungsstart, "
        "\"0\" fuer Klartext."
    )
    pdf.bullet("MAIL_IMAP_USER \u2013 IMAP-Benutzername.")
    pdf.bullet("MAIL_IMAP_PASSWORD \u2013 IMAP-Passwort.")
    pdf.bullet(
        "MAIL_IMAP_MAILBOX \u2013 Postfach-Ordnername (Standard: \"INBOX\")."
    )
    pdf.bullet(
        "MAIL_IMAP_TLS_REJECT_UNAUTHORIZED \u2013 \"1\" um selbstsignierte "
        "Zertifikate abzulehnen."
    )

    # -- 16.13 POP3 --
    pdf.section_title("16.13 POP3-Konfiguration")
    pdf.bullet("MAIL_POP3_HOST \u2013 POP3-Server-Hostname.")
    pdf.bullet(
        "MAIL_POP3_PORT \u2013 POP3-Port (Standard: 995 fuer TLS, "
        "110 fuer Klartext)."
    )
    pdf.bullet(
        "MAIL_POP3_SECURE \u2013 \"1\" fuer TLS ab Verbindungsstart, "
        "\"0\" fuer Klartext."
    )
    pdf.bullet("MAIL_POP3_USER \u2013 POP3-Benutzername.")
    pdf.bullet("MAIL_POP3_PASSWORD \u2013 POP3-Passwort.")
    pdf.bullet(
        "MAIL_POP3_TLS_REJECT_UNAUTHORIZED \u2013 \"1\" um selbstsignierte "
        "Zertifikate abzulehnen."
    )

    # -- 16.14 Chatbot --
    pdf.add_page()
    pdf.section_title("16.14 Chatbot-Integration")
    pdf.bullet(
        "CHATBOT_BASE_URL \u2013 URL des Chatbot-Servers "
        "(Standard: \"http://127.0.0.1:3100\")."
    )
    pdf.bullet("CHATBOT_PORT \u2013 Chatbot-Server-Port (Standard: 3100).")
    pdf.bullet(
        "CHATBOT_HOST \u2013 Chatbot-Bind-Adresse (Standard: \"0.0.0.0\")."
    )
    pdf.bullet(
        "CHATBOT_PROFILE \u2013 Konfigurationsprofil-Name (Standard: \"default\")."
    )
    pdf.bullet("CHATBOT_DEBUG \u2013 \"1\" aktiviert Chatbot-Debug-Logging.")
    pdf.bullet(
        "CHATBOT_AUTO_STEP_MS \u2013 Auto-Step-Intervall in ms "
        "(Standard: 120000)."
    )
    pdf.bullet("DEBUG_PROXY \u2013 \"1\" aktiviert Proxy-Debugging.")
    pdf.bullet("DEBUG_SITUATION \u2013 \"1\" aktiviert Situations-Debugging.")

    # -- 16.15 LLM --
    pdf.section_title("16.15 LLM-Konfiguration")
    pdf.bullet(
        "LLM_BASE_URL \u2013 Ollama/LLM-Server-URL "
        "(Standard: \"http://127.0.0.1:11434\")."
    )
    pdf.bullet(
        "LLM_CHAT_MODEL \u2013 Chat-Modellname (Standard: \"llama3.1:8b\")."
    )
    pdf.bullet(
        "LLM_EMBED_MODEL \u2013 Embedding-Modellname "
        "(Standard: \"mxbai-embed-large\")."
    )
    pdf.bullet("LLM_TEMP \u2013 Standard-Temperatur (Standard: 0.05).")
    pdf.bullet("LLM_SEED \u2013 Zufallswert / Seed (Standard: 42).")
    pdf.bullet(
        "LLM_CHAT_TIMEOUT_MS \u2013 Chat-Request-Timeout in ms "
        "(Standard: 60000)."
    )
    pdf.bullet(
        "LLM_SIM_TIMEOUT_MS \u2013 Simulations-Timeout in ms "
        "(Standard: 300000)."
    )
    pdf.bullet(
        "LLM_EMBED_TIMEOUT_MS \u2013 Embedding-Timeout in ms "
        "(Standard: 30000)."
    )
    pdf.bullet(
        "LLM_TIMEOUT_MS \u2013 Allgemeines Timeout in ms "
        "(Standard: 240000)."
    )
    pdf.bullet(
        "LLM_NUM_CTX \u2013 Kontext-Fenstergroesse (Standard: 8192)."
    )
    pdf.bullet("LLM_NUM_BATCH \u2013 Batch-Groesse (Standard: 512).")

    # -- 16.16 GPU/Ollama --
    pdf.section_title("16.16 GPU / Ollama")
    pdf.bullet(
        "CUDA_VISIBLE_DEVICES \u2013 Zu verwendende GPU-Geraete "
        "(Standard: \"0\")."
    )
    pdf.bullet(
        "OLLAMA_NUM_GPU \u2013 Anzahl der GPU-Layer "
        "(Standard: 22 fuer 8 GB VRAM auf RTX 4070)."
    )
    pdf.bullet(
        "OLLAMA_MAX_LOADED_MODELS \u2013 Max. gleichzeitig geladene Modelle "
        "(Standard: 1)."
    )
    pdf.bullet(
        "OLLAMA_KEEP_ALIVE \u2013 Keep-Alive-Dauer fuer Modelle "
        "(Standard: \"30m\")."
    )

    # -- 16.17 RAG --
    pdf.add_page()
    pdf.section_title("16.17 RAG-Konfiguration")
    pdf.bullet("RAG_DIM \u2013 Embedding-Dimension (Standard: 1024).")
    pdf.bullet("RAG_TOP_K \u2013 Anzahl Top-K-Ergebnisse (Standard: 10).")
    pdf.bullet(
        "RAG_MAX_CTX \u2013 Maximale Kontext-Zeichen (Standard: 4000)."
    )
    pdf.bullet(
        "RAG_MAX_ELEM \u2013 Maximale Index-Elemente (Standard: 50000)."
    )
    pdf.bullet(
        "RAG_SCORE_THRESHOLD \u2013 Score-Schwellenwert (Standard: 0.2)."
    )
    pdf.bullet("EMBED_CACHE_SIZE \u2013 Embedding-Cache-Groesse (Standard: 200).")

    # -- 16.18 Prompt --
    pdf.section_title("16.18 Prompt-Konfiguration")
    pdf.bullet(
        "PROMPT_MAX_BOARD \u2013 Max. Board-Eintraege im Prompt (Standard: 25)."
    )
    pdf.bullet(
        "PROMPT_MAX_AUFGABEN \u2013 Max. Aufgaben-Eintraege (Standard: 50)."
    )
    pdf.bullet(
        "PROMPT_MAX_PROTOKOLL \u2013 Max. Protokoll-Eintraege (Standard: 30)."
    )

    # -- 16.19 Memory/RAG --
    pdf.section_title("16.19 Memory / RAG-Langzeit")
    pdf.bullet(
        "MEM_RAG_LONG_MIN_ITEMS \u2013 Min. Eintraege fuer Langzeit-Szenario "
        "(Standard: 100)."
    )
    pdf.bullet(
        "MEM_RAG_MAX_AGE_MIN \u2013 Max. Alter in Minuten (Standard: 720)."
    )
    pdf.bullet(
        "MEM_RAG_HALF_LIFE_MIN \u2013 Halbwertszeit fuer Aktualitaet "
        "in Minuten (Standard: 120)."
    )
    pdf.bullet(
        "MEM_RAG_LONG_TOP_K \u2013 Top-K fuer Langzeit-Szenario "
        "(Standard: 12)."
    )

    # -- 16.20 Simulation --
    pdf.section_title("16.20 Simulation")
    pdf.bullet(
        "SIM_WORKER_INTERVAL_MS \u2013 Simulations-Worker-Intervall "
        "in ms (Standard: 60000)."
    )
    pdf.bullet("SIM_MAX_RETRIES \u2013 Max. Wiederholungen (Standard: 3).")
    pdf.bullet(
        "SIM_RETRY_DELAY_MS \u2013 Verzoegerung zwischen Wiederholungen "
        "in ms (Standard: 5000)."
    )
    pdf.bullet(
        "MAIN_SERVER_URL \u2013 URL des Hauptservers "
        "(Standard: \"http://localhost:4000\")."
    )

    # -- 16.21 Experimentell --
    pdf.section_title("16.21 Experimentelle Features")
    pdf.bullet(
        "EINFO_EXPERIMENTAL_SCENARIOPACK \u2013 \"1\" aktiviert experimentelle "
        "Szenariopakete (Standard: 0)."
    )
    pdf.bullet(
        "EINFO_DATA_DIR \u2013 Alternatives Datenverzeichnis fuer "
        "den Chatbot."
    )

    # -- 16.22 Sonstige --
    pdf.section_title("16.22 Sonstige")
    pdf.bullet(
        "WEATHER_WARNING_DATE_FILE \u2013 Pfad fuer die "
        "Wetterwarnungs-Datumsdatei."
    )

    # -- 16.23 Client (Vite) --
    pdf.section_title("16.23 Client-seitige Umgebungsvariablen (Vite)")
    pdf.body(
        "Diese Variablen werden zur Build-Zeit ausgewertet und muessen "
        "mit dem Praefix VITE_ beginnen:"
    )
    pdf.bullet("VITE_API_BASE_URL \u2013 URL des API-Servers.")
    pdf.bullet("VITE_LOGIN_BASE_URL \u2013 URL des Login-Servers.")
    pdf.bullet("VITE_CHATBOT_BASE_URL \u2013 URL des Chatbot-Servers.")
    pdf.bullet(
        "VITE_STATUS_POLL_INTERVAL_MS \u2013 Status-Polling-Intervall "
        "in ms (Standard: 3000)."
    )
    pdf.bullet(
        "VITE_ACTIVITY_POLL_INTERVAL_MS \u2013 Aktivitaets-Polling-Intervall "
        "in ms (Standard: 1000)."
    )

    # ================================================================
    # 17. API-Referenz
    # ================================================================
    pdf.add_page()
    pdf.chapter_title("17. API-Referenz")
    pdf.body(
        "Alle API-Endpunkte sind unter /api/ erreichbar und erfordern "
        "(sofern nicht anders angegeben) eine gueltige Benutzer-Session. "
        "Antworten erfolgen im JSON-Format."
    )

    # -- 17.1 Board & Fahrzeuge --
    pdf.section_title("17.1 Einsatzboard & Fahrzeuge")
    pdf.bullet("GET  /api/board \u2013 Gibt das komplette Einsatzboard mit allen Spalten zurueck.")
    pdf.bullet("GET  /api/vehicles \u2013 Listet alle Fahrzeuge (Basis + Zusatz) auf.")
    pdf.bullet("POST /api/vehicles \u2013 Legt ein neues Fahrzeug an oder klont ein bestehendes.")
    pdf.bullet("PATCH /api/vehicles/:id/availability \u2013 Aendert die Verfuegbarkeit eines Fahrzeugs.")
    pdf.bullet("PATCH /api/vehicles/:id/position \u2013 Aktualisiert die GPS-Position eines Fahrzeugs.")
    pdf.bullet("DELETE /api/vehicles/:id/position \u2013 Loescht eine manuelle Positions-Ueberschreibung.")
    pdf.bullet("GET  /api/groups/availability \u2013 Gibt den Verfuegbarkeitsstatus aller Gruppen zurueck.")
    pdf.bullet("GET  /api/groups/alerted \u2013 Listet alarmierte Gruppen auf.")
    pdf.bullet("PATCH /api/groups/:name/availability \u2013 Aendert die Verfuegbarkeit einer Gruppe.")
    pdf.bullet("GET  /api/gps \u2013 Gibt GPS-Daten zurueck.")
    pdf.bullet("GET  /api/types \u2013 Gibt verfuegbare Einsatztypen zurueck.")
    pdf.bullet("GET  /api/nearby \u2013 Sucht naechstgelegene Einheiten/Ressourcen.")

    # -- 17.2 Einsatzkarten --
    pdf.section_title("17.2 Einsatzkarten (Cards)")
    pdf.bullet("POST /api/cards \u2013 Legt eine neue Einsatzkarte an.")
    pdf.bullet("POST /api/cards/:id/move \u2013 Verschiebt eine Karte in eine andere Spalte.")
    pdf.bullet("POST /api/cards/:id/assign \u2013 Weist ein Fahrzeug einer Karte zu.")
    pdf.bullet("POST /api/cards/:id/unassign \u2013 Entfernt ein Fahrzeug von einer Karte.")
    pdf.bullet("PATCH /api/cards/:id/personnel \u2013 Aktualisiert die Personalstaerke einer Karte.")
    pdf.bullet(
        "PATCH /api/cards/:id \u2013 Aktualisiert Karten-Eigenschaften "
        "(Titel, Ort, Typ, Koordinaten, Abschnitt usw.)."
    )

    # -- 17.3 Protokoll --
    pdf.add_page()
    pdf.section_title("17.3 Protokoll (Meldestelle)")
    pdf.bullet("GET  /api/protocol \u2013 Listet alle Protokolleintraege auf.")
    pdf.bullet("POST /api/protocol \u2013 Erstellt einen neuen Protokolleintrag.")
    pdf.bullet("GET  /api/protocol/:nr \u2013 Gibt einen bestimmten Eintrag zurueck.")
    pdf.bullet("PUT  /api/protocol/:nr \u2013 Aktualisiert einen Protokolleintrag.")
    pdf.bullet("POST /api/protocol/:nr/lock \u2013 Sperrt einen Eintrag zur Bearbeitung.")
    pdf.bullet("DELETE /api/protocol/:nr/lock \u2013 Gibt die Sperre eines Eintrags frei.")
    pdf.bullet("GET  /api/protocol/csv/file \u2013 Exportiert das Protokoll als CSV-Datei.")
    pdf.bullet(
        "GET  /api/protocol/auto-print-config \u2013 Gibt die Auto-Druck-Konfiguration "
        "zurueck (nur Admin)."
    )
    pdf.bullet(
        "POST /api/protocol/auto-print-config \u2013 Aktualisiert die "
        "Auto-Druck-Konfiguration (nur Admin)."
    )

    # -- 17.4 Aufgaben --
    pdf.section_title("17.4 Aufgaben")
    pdf.bullet("GET  /api/aufgaben \u2013 Listet alle Aufgaben fuer die aktuelle Rolle auf.")
    pdf.bullet("POST /api/aufgaben \u2013 Erstellt eine neue Aufgabe.")
    pdf.bullet("POST /api/aufgaben/:id/edit \u2013 Bearbeitet eine bestehende Aufgabe.")
    pdf.bullet("POST /api/aufgaben/:id/status \u2013 Aendert den Status einer Aufgabe.")
    pdf.bullet("POST /api/aufgaben/reorder \u2013 Sortiert Aufgaben um.")
    pdf.bullet("GET  /api/aufgaben/config \u2013 Gibt die Aufgabenkonfiguration zurueck.")
    pdf.bullet("GET  /api/aufgaben/protocols \u2013 Gibt Protokolle fuer die aktuelle Rolle zurueck.")

    # -- 17.5 Mail --
    pdf.section_title("17.5 Mail")
    pdf.bullet("GET  /api/mail/status \u2013 Gibt den Mail-Konfigurationsstatus zurueck.")
    pdf.bullet("POST /api/mail/send \u2013 Versendet eine E-Mail.")
    pdf.bullet("GET  /api/mail/inbox/status \u2013 Prueft den Inbox-Status.")
    pdf.bullet("GET  /api/mail/inbox \u2013 Listet Inbox-Nachrichten auf (mit optionalem limit-Parameter).")
    pdf.bullet("GET  /api/mail/schedule \u2013 Listet alle Mail-Zeitplaene auf (nur Admin).")
    pdf.bullet("POST /api/mail/schedule \u2013 Erstellt einen neuen Mail-Zeitplan (nur Admin).")
    pdf.bullet("PUT  /api/mail/schedule/:id \u2013 Aktualisiert einen Mail-Zeitplan (nur Admin).")
    pdf.bullet("DELETE /api/mail/schedule/:id \u2013 Loescht einen Mail-Zeitplan (nur Admin).")

    # -- 17.6 HTTP-Zeitplaene --
    pdf.add_page()
    pdf.section_title("17.6 HTTP-API-Zeitplaene")
    pdf.bullet("GET  /api/http/schedule \u2013 Listet alle HTTP-Zeitplaene auf (nur Admin).")
    pdf.bullet("POST /api/http/schedule \u2013 Erstellt einen neuen HTTP-Zeitplan (nur Admin).")
    pdf.bullet("PUT  /api/http/schedule/:id \u2013 Aktualisiert einen HTTP-Zeitplan (nur Admin).")
    pdf.bullet("DELETE /api/http/schedule/:id \u2013 Loescht einen HTTP-Zeitplan (nur Admin).")

    # -- 17.7 Import / Export --
    pdf.section_title("17.7 Import & Export")
    pdf.bullet("GET  /api/import/auto-config \u2013 Gibt die Auto-Import-Konfiguration zurueck.")
    pdf.bullet("POST /api/import/auto-config \u2013 Aktualisiert die Auto-Import-Konfiguration.")
    pdf.bullet("POST /api/import/trigger \u2013 Loest einen sofortigen Import aus.")
    pdf.bullet("GET  /api/export/pdf \u2013 Exportiert das Board als PDF.")
    pdf.bullet("GET  /api/log.csv \u2013 Laedt das Aktivitaetsprotokoll als CSV herunter.")

    # -- 17.8 Fetcher-Steuerung --
    pdf.section_title("17.8 Feuerwehr-Fetcher")
    pdf.bullet("GET  /api/ff/status \u2013 Gibt den Fetcher-Status zurueck.")
    pdf.bullet("GET  /api/ff/status/details \u2013 Gibt detaillierten Fetcher-Status zurueck.")
    pdf.bullet("GET  /api/ff/creds \u2013 Prueft, ob Fetcher-Zugangsdaten vorhanden sind.")
    pdf.bullet("POST /api/ff/creds \u2013 Speichert Fetcher-Zugangsdaten.")
    pdf.bullet("POST /api/ff/start \u2013 Startet den Fetcher-Dienst.")
    pdf.bullet("POST /api/ff/stop \u2013 Stoppt den Fetcher-Dienst.")

    # -- 17.9 Drucken --
    pdf.section_title("17.9 Drucken")
    pdf.bullet("POST /api/print/server \u2013 Druckt ein PDF ueber den Systemdrucker.")
    pdf.bullet("GET  /api/print/server/info \u2013 Gibt Drucker-Informationen zurueck.")
    pdf.bullet("POST /api/print/:nr/print \u2013 Druckt einen Protokolleintrag.")
    pdf.bullet("POST /api/print/blank/print \u2013 Druckt ein leeres Protokollformular.")
    pdf.bullet("GET  /api/print/:nr/print/file/:file \u2013 Gibt eine gedruckte Protokolldatei zurueck.")
    pdf.bullet("GET  /api/print/blank/print/file/:file \u2013 Gibt eine leere Protokolldatei zurueck.")
    pdf.bullet(
        "POST /api/incident-print/:incidentId/print \u2013 Speichert einen "
        "Einsatz als PDF."
    )
    pdf.bullet(
        "POST /api/incident-print/:incidentId/mail \u2013 Versendet einen "
        "Einsatz per E-Mail."
    )

    # -- 17.10 KI-Analyse / Situation --
    pdf.add_page()
    pdf.section_title("17.10 KI-Analyse & Situationsanalyse")
    pdf.bullet("GET  /api/situation/status \u2013 Gibt den Analyse-Status zurueck.")
    pdf.bullet(
        "POST /api/situation/analysis-loop/sync \u2013 Synchronisiert den "
        "Analyse-Zyklus."
    )
    pdf.bullet("GET  /api/situation/analysis \u2013 Gibt das Analyse-Ergebnis zurueck.")
    pdf.bullet("POST /api/situation/question \u2013 Stellt eine Situations-Frage.")
    pdf.bullet(
        "POST /api/situation/suggestion/feedback \u2013 Gibt Feedback "
        "zu einem Vorschlag."
    )
    pdf.bullet(
        "POST /api/situation/question/feedback \u2013 Gibt Feedback zu "
        "einer Antwort."
    )
    pdf.bullet("GET  /api/situation/analysis-config \u2013 Gibt die Analyse-Konfiguration zurueck.")
    pdf.bullet("POST /api/situation/analysis-config \u2013 Aktualisiert die Analyse-Konfiguration.")

    # -- 17.11 Admin-Filterregeln --
    pdf.section_title("17.11 Admin-Filterregeln")
    pdf.bullet("GET  /api/admin/filtering-rules/status \u2013 Gibt den Filterstatus zurueck.")
    pdf.bullet("GET  /api/admin/filtering-rules \u2013 Listet alle Filterregeln auf.")
    pdf.bullet("PUT  /api/admin/filtering-rules \u2013 Aktualisiert die Filterregeln.")
    pdf.bullet("GET  /api/admin/filtering-rules/learned \u2013 Gibt gelernte Filtergewichte zurueck.")
    pdf.bullet("POST /api/admin/filtering-rules/reset-learned \u2013 Setzt gelernte Gewichte zurueck.")
    pdf.bullet("GET  /api/admin/filtering-rules/ai-analysis-config \u2013 Gibt die KI-Analyse-Konfiguration zurueck.")
    pdf.bullet("PUT  /api/admin/filtering-rules/ai-analysis-config \u2013 Aktualisiert die KI-Analyse-Konfiguration.")
    pdf.bullet("GET  /api/admin/filtering-rules/scenario \u2013 Gibt die Szenario-Konfiguration zurueck.")
    pdf.bullet("PUT  /api/admin/filtering-rules/scenario \u2013 Aktualisiert die Szenario-Konfiguration.")

    # -- 17.12 Benutzer & Rollen --
    pdf.section_title("17.12 Benutzer & Rollen")
    pdf.bullet("GET  /api/user/roles \u2013 Gibt alle Rollen zurueck.")
    pdf.bullet("PUT  /api/user/roles \u2013 Aktualisiert die Rollen (nur Admin).")
    pdf.bullet("GET  /api/user/online-roles \u2013 Gibt online-aktive Rollen zurueck.")

    # -- 17.13 Admin-Verwaltung --
    pdf.add_page()
    pdf.section_title("17.13 Admin-Verwaltung")
    pdf.bullet("POST /api/user/admin/initialsetup \u2013 Erststart: Initialisiert das System mit Standarddaten.")
    pdf.bullet("POST /api/user/admin/archive \u2013 Erstellt ein ZIP-Archiv aller Daten.")
    pdf.bullet("GET  /api/user/admin/archive/create-download \u2013 Erstellt ein Archiv und gibt es zum Download zurueck.")
    pdf.bullet("GET  /api/user/admin/archive/download/:file \u2013 Laedt eine bestimmte Archivdatei herunter.")
    pdf.bullet("GET  /api/user/admin/archive/testlist \u2013 Listet Test-Archive auf.")
    pdf.bullet("GET  /api/user/admin/logs/download \u2013 Laedt Logdateien herunter.")
    pdf.bullet("GET  /api/user/admin/chatbot/status \u2013 Gibt den Chatbot-Service-Status zurueck.")
    pdf.bullet("POST /api/user/admin/chatbot/start \u2013 Startet den Chatbot-Service.")
    pdf.bullet("POST /api/user/admin/chatbot/stop \u2013 Stoppt den Chatbot-Service.")
    pdf.bullet("POST /api/user/admin/chatbot/server/start \u2013 Startet den Chatbot-Server.")
    pdf.bullet("POST /api/user/admin/chatbot/server/stop \u2013 Stoppt den Chatbot-Server.")
    pdf.bullet("POST /api/user/admin/chatbot/worker/start \u2013 Startet den Chatbot-Worker.")
    pdf.bullet("POST /api/user/admin/chatbot/worker/stop \u2013 Stoppt den Chatbot-Worker.")
    pdf.bullet("GET  /api/user/admin/worker/config \u2013 Gibt die Worker-Konfiguration zurueck.")
    pdf.bullet("PATCH /api/user/admin/worker/config \u2013 Aktualisiert die Worker-Konfiguration.")

    # -- 17.14 Knowledge-Basis --
    pdf.section_title("17.14 Knowledge-Basis (RAG)")
    pdf.bullet("GET  /api/user/admin/knowledge/files \u2013 Listet Knowledge-Dateien auf.")
    pdf.bullet("POST /api/user/admin/knowledge/upload \u2013 Laedt eine einzelne Knowledge-Datei hoch.")
    pdf.bullet("POST /api/user/admin/knowledge/upload-multiple \u2013 Laedt mehrere Dateien hoch (max. 20).")
    pdf.bullet("DELETE /api/user/admin/knowledge/files/:filename \u2013 Loescht eine Knowledge-Datei.")
    pdf.bullet("POST /api/user/admin/knowledge/ingest \u2013 Startet die Indizierung der Knowledge-Basis.")

    # -- 17.15 Aktivitaet --
    pdf.section_title("17.15 Aktivitaet & Status")
    pdf.bullet(
        "GET  /api/activity/status \u2013 Gibt den Systemaktivitaetsstatus zurueck "
        "(oeffentlich, keine Authentifizierung erforderlich)."
    )

    # -- 17.16 Chatbot-Server API --
    pdf.add_page()
    pdf.section_title("17.16 Chatbot-Server API (Port 3100)")
    pdf.body(
        "Die folgenden Endpunkte sind auf dem separaten Chatbot-Server "
        "verfuegbar und werden vom Hauptserver teilweise als Proxy "
        "weitergeleitet."
    )
    pdf.sub_section("Szenarien & Simulation")
    pdf.bullet("GET  /api/scenarios \u2013 Listet alle verfuegbaren Szenarien auf.")
    pdf.bullet("GET  /api/scenarios/:scenarioId \u2013 Gibt Details eines Szenarios zurueck.")
    pdf.bullet("POST /api/sim/start \u2013 Startet eine Simulation (mit optionalem Szenario).")
    pdf.bullet("GET  /api/sim/status \u2013 Gibt den Simulations-Status zurueck.")
    pdf.bullet("GET  /api/sim/scenario \u2013 Gibt das aktive Szenario zurueck.")
    pdf.bullet("POST /api/sim/pause \u2013 Pausiert die Simulation.")
    pdf.bullet("POST /api/sim/step \u2013 Fuehrt einen einzelnen Simulationsschritt aus.")
    pdf.bullet("POST /api/sim/waiting-for-roles \u2013 Signalisiert Warten auf Rollen.")

    pdf.sub_section("Chat & LLM")
    pdf.bullet("POST /api/chat \u2013 Sendet eine Chat-Nachricht (Rate-Limit: 60/min).")
    pdf.bullet("GET  /api/llm/models \u2013 Listet verfuegbare LLM-Modelle auf.")
    pdf.bullet("GET  /api/llm/gpu \u2013 Gibt den GPU-Status zurueck.")
    pdf.bullet("GET  /api/llm/system \u2013 Gibt den Systemstatus zurueck.")
    pdf.bullet("POST /api/llm/test \u2013 Testet das LLM mit einer Frage (Rate-Limit: 10/min).")
    pdf.bullet("GET  /api/llm/config \u2013 Gibt die LLM-Konfiguration zurueck.")
    pdf.bullet("POST /api/llm/global-model \u2013 Setzt das globale LLM-Modell.")
    pdf.bullet("POST /api/llm/task-config \u2013 Konfiguriert aufgabenspezifische LLM-Einstellungen.")
    pdf.bullet("GET  /api/llm/model/:taskType \u2013 Gibt das Modell fuer einen Aufgabentyp zurueck.")
    pdf.bullet("POST /api/llm/test-model \u2013 Testet ein bestimmtes Modell (Rate-Limit: 10/min).")
    pdf.bullet("POST /api/llm/test-with-metrics \u2013 Testet mit Metriken (Rate-Limit: 10/min).")
    pdf.bullet("POST /api/llm/test-with-metrics-stream \u2013 Testet mit Metriken als Stream (Rate-Limit: 10/min).")
    pdf.bullet("GET  /api/llm/profiles \u2013 Gibt verfuegbare LLM-Profile zurueck.")
    pdf.bullet("GET  /api/llm/prompt-templates \u2013 Listet Prompt-Templates auf.")
    pdf.bullet("GET  /api/llm/prompt-templates/:name \u2013 Gibt ein bestimmtes Prompt-Template zurueck.")
    pdf.bullet("PUT  /api/llm/prompt-templates/:name \u2013 Aktualisiert ein Prompt-Template (Rate-Limit: 10/min).")
    pdf.bullet("GET  /api/llm/action-history \u2013 Gibt die LLM-Aktionshistorie zurueck.")
    pdf.bullet("GET  /api/llm/ops-verworfen \u2013 Gibt verworfene Operationen zurueck.")
    pdf.bullet("GET  /api/llm/exchange/:exchangeId \u2013 Gibt einen bestimmten LLM-Austausch zurueck.")

    pdf.add_page()
    pdf.sub_section("Metriken & Monitoring")
    pdf.bullet("GET  /api/metrics \u2013 Gibt Simulations-Metriken zurueck.")
    pdf.bullet("GET  /api/metrics/stats \u2013 Gibt Metrik-Statistiken zurueck.")
    pdf.bullet("GET  /api/events \u2013 Event-Stream (Server-Sent Events).")

    pdf.sub_section("Audit")
    pdf.bullet("GET  /api/audit/status \u2013 Gibt den Audit-Status zurueck.")
    pdf.bullet("POST /api/audit/start \u2013 Startet eine Audit-Aufzeichnung.")
    pdf.bullet("POST /api/audit/end \u2013 Beendet eine Audit-Aufzeichnung.")
    pdf.bullet("GET  /api/audit/list \u2013 Listet alle Audit-Sessions auf.")
    pdf.bullet("GET  /api/audit/:exerciseId \u2013 Gibt Audit-Daten fuer eine Uebung zurueck.")
    pdf.bullet("DELETE /api/audit/:exerciseId \u2013 Loescht Audit-Daten.")
    pdf.bullet("POST /api/audit/pause \u2013 Pausiert die Audit-Aufzeichnung.")
    pdf.bullet("POST /api/audit/resume \u2013 Setzt die Audit-Aufzeichnung fort.")
    pdf.bullet("POST /api/audit/events \u2013 Zeichnet Audit-Ereignisse auf.")

    pdf.sub_section("Templates & Uebungen")
    pdf.bullet("GET  /api/templates \u2013 Listet alle Templates auf.")
    pdf.bullet("GET  /api/templates/:templateId \u2013 Gibt ein bestimmtes Template zurueck.")
    pdf.bullet("POST /api/templates \u2013 Erstellt ein neues Template.")
    pdf.bullet("DELETE /api/templates/:templateId \u2013 Loescht ein Template.")
    pdf.bullet("POST /api/templates/:templateId/create-exercise \u2013 Erstellt eine Uebung aus einem Template.")

    pdf.sub_section("Katastrophen-Kontext")
    pdf.bullet("GET  /api/disaster/current \u2013 Gibt den aktuellen Katastrophen-Kontext zurueck.")
    pdf.bullet("GET  /api/disaster/summary \u2013 Gibt eine gefilterte Zusammenfassung zurueck.")
    pdf.bullet("POST /api/disaster/init \u2013 Initialisiert einen Katastrophen-Kontext.")
    pdf.bullet("POST /api/disaster/update \u2013 Aktualisiert den Kontext aus EINFO-Daten.")
    pdf.bullet("GET  /api/disaster/list \u2013 Listet alle Katastrophen auf.")
    pdf.bullet("GET  /api/disaster/:disasterId \u2013 Gibt eine bestimmte Katastrophe zurueck.")
    pdf.bullet("POST /api/disaster/finalize \u2013 Schliesst einen Katastrophen-Kontext ab.")
    pdf.bullet("POST /api/disaster/record-suggestion \u2013 Zeichnet einen Vorschlag auf.")

    pdf.sub_section("Feedback & Lernen")
    pdf.bullet("POST /api/feedback \u2013 Gibt Feedback ab.")
    pdf.bullet("GET  /api/feedback/list \u2013 Listet Feedback-Eintraege auf.")
    pdf.bullet("GET  /api/feedback/stats \u2013 Gibt Feedback-Statistiken zurueck.")
    pdf.bullet("POST /api/feedback/similar \u2013 Sucht aehnliches Feedback.")
    pdf.bullet("POST /api/feedback/learned-context \u2013 Zeichnet gelernten Kontext auf.")

    # ----------------------------------------------------------------
    # 18. Backup & Recovery
    # ----------------------------------------------------------------
    pdf.add_page()
    pdf.chapter_title("18. Backup & Recovery")
    pdf.body(
        "Erstellen Sie regelm\u00e4\u00dfig Backups des Verzeichnisses server/data/ vor "
        "gr\u00f6\u00dferen \u00c4nderungen. Das Verzeichnis enth\u00e4lt alle persistenten Daten:"
    )
    pdf.bullet("Benutzer- und Rollendaten")
    pdf.bullet("Einsatz- und Aufgabenboards")
    pdf.bullet("Protokolldaten und gedruckte PDFs")
    pdf.bullet("Filterregeln und gelernte Gewichte")
    pdf.bullet("Szenario- und Analyse-Konfigurationen")

    pdf.section_title("Bei verlorenem Admin-Zugang")
    pdf.body(
        "Sichern Sie die Dateien User_master.json und User_users.enc.json. "
        "Entfernen Sie diese Dateien und starten Sie den Server neu. "
        "Navigieren Sie zu /user-firststart, um einen neuen Master-Key und "
        "Admin-Benutzer anzulegen. Die Rollendefinitionen (User_roles.json) "
        "bleiben dabei erhalten."
    )

    pdf.section_title("Wartung")
    pdf.body(
        "Im Admin-Panel steht im Bereich \u201eWartung (Admin)\u201c eine Funktion zum "
        "Herunterladen von Backup-Dateien und Logdateien zur Verf\u00fcgung. "
        "Nutzen Sie diese regelm\u00e4\u00dfig, um Datenverluste zu vermeiden."
    )

    # -- Speichern --
    path = os.path.join(OUT_DIR, "EINFO_Admin_Hilfe_v2.pdf")
    pdf.output(path)
    print(f"  \u2713 {path}")


# ======================================================================
#  MAIN
# ======================================================================
if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    print("Generiere Hilfe-PDFs ...")
    generate_einsatzboard()
    generate_aufgabenboard()
    generate_meldestelle()
    generate_admin_help()
    print("Fertig.")
