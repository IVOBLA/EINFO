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
#  MAIN
# ======================================================================
if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    print("Generiere Hilfe-PDFs ...")
    generate_einsatzboard()
    generate_aufgabenboard()
    generate_meldestelle()
    print("Fertig.")
