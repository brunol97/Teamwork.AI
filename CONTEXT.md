# Agent Office

Gedeelde werkplek waar teams en AI-agents samen aan taken werken, in plaats van ieder in een eigen AI-chat.

## Language

### Account en structuur

**Organisatie**:
Een team of persoonlijke werkruimte waarbinnen mensen, agents, projecten en skills gedeeld worden.
_Avoid_: werkruimte, workspace, team (als los begrip)

**Klant**:
De opdrachtgever van de organisatie waarvoor projecten worden uitgevoerd.
_Avoid_: opdrachtgever, client, account

**Project**:
Groepering van taken rond één doel, direct onder een organisatie of onder een klant.
_Avoid_: werkruimte, board

**Taak**:
Een gedeelde werkplek met gesprek en werkdocument waarin mensen en agents samenwerken.
_Avoid_: sessie (als hoofdbegrip), chat, ticket

### Mensen in een taak

**Lead**:
De mens die verantwoordelijk is voor de taak; er is altijd precies één lead per taak.
_Avoid_: eigenaar, owner, verantwoordelijke

**Deelnemer**:
Iemand die daadwerkelijk heeft bijgedragen aan een taak, afgeleid uit het activiteitenlog.
_Avoid_: deelnemer als expliciete rol, medewerker

**Volger**:
Iemand die meldingen ontvangt over een taak zonder daarbij actief mee te werken.
_Avoid_: abonnee, watcher

### Agents

**Agent**:
Een AI-rol met naam, omschrijving, tools, skills en rechten die werk doet namens de lead.
_Avoid_: bot, assistent

**Actieve agent**:
De agent die op dit moment verantwoordelijk is voor de hoofdthread van een taak.
_Avoid_: huidige agent, agent aan het woord

**Uitbesteden**:
De actieve agent vraagt een andere agent om een deeltaak in een eigen thread en blijft zelf actief.
_Avoid_: delegeren, subtaak

**Wisselen**:
De actieve agent van een taak wordt vervangen door een andere agent, met een overdrachtsnotitie.
_Avoid_: overdragen (te breed), escalatie

### Skills en leren

**Skill**:
Een herbruikbaar recept voor een soort taak in SKILL.md-formaat, met een menselijke eigenaar.
_Avoid_: prompt, template, playbook

**Evaluatie**:
Terugblik die een agent maakt na een taak met agent-activiteit, gericht op verbetering van skills.
_Avoid_: retrospect, review, samenvatting

**Skill-voorstel**:
Een door een agent voorgestelde wijziging aan een skill, die de eigenaar goedkeurt, aanpast of afwijst.
_Avoid_: pull request, wijzigingsverzoek

### Mens-agent interactie

**Human task**:
Een verzoek van een agent aan een persoon dat een antwoord vereist, waardoor de taak pauzeert. De vraag gaat alleen aan een lid van de organisatie en is altijd op te heffen, zodat een onbeantwoordbare vraag de taak nooit vasthoudt.
_Avoid_: vraag, ticket, actie-item

**Melding**:
Een eenrichtingsbericht van een agent aan een persoon dat geen antwoord vereist en de taak niet pauzeert.
_Avoid_: notify, alert, bericht

**Herinnering**:
Een bericht van een agent aan één persoon dat er een human task op hem of haar wacht; het komt per e-mail binnen. Het is geen melding: het vereist een antwoord en de taak pauzeert erdoor. De herinnering is een extra weg naar de vraag, niet de enige: de vraag staat in "Wacht op jou".
_Avoid_: melding, notitie, pushbericht

### Documenten en log

**Werkdocument**:
Het document binnen een taak: vrije tekst met koppen, tabellen en opsommingen.
_Avoid_: document, editor, wiki

**Tracer-slice**:
Een onderdeel van het werkdocument dat een dunne, verticale implementatie-opdracht beschrijft, inclusief testaanpak.
_Avoid_: slice, story, ticket

**Overdrachtsnotitie**:
Een concept dat automatisch wordt opgesteld bij pauzeren of wisselen, en pas bij finalisatie onveranderlijk in het log wordt opgenomen.
_Avoid_: handover, notitie

**Activiteitenlog**:
De onveranderlijke lijst van alle gebeurtenissen in een taak; het gesprek is een gefilterde weergave hiervan.
_Avoid_: audit log, chatgeschiedenis
