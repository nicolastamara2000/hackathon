"""Fictional clubs and squads. Every name here is invented on purpose."""

from __future__ import annotations

import numpy as np

from .schema import Player, Team

CLUBS = [
    # name, short, city, colours, strength, pressing, directness
    ("Harbour City FC", "HCF", "Harbour City", ("#0B3D91", "#FFFFFF"), 0.78, 0.70, 0.35),
    ("Redmill Athletic", "RMA", "Redmill", ("#B22222", "#F5F5F5"), 0.72, 0.55, 0.55),
    ("Northgate Rovers", "NGR", "Northgate", ("#1E7B4F", "#FFD23F"), 0.66, 0.62, 0.45),
    ("Kingsbridge United", "KBU", "Kingsbridge", ("#5B2A86", "#FFFFFF"), 0.70, 0.48, 0.40),
    ("Ashford Vale", "ASV", "Ashford", ("#F28C28", "#111111"), 0.60, 0.66, 0.60),
    ("Silverlake Town", "SLT", "Silverlake", ("#8A9BA8", "#0A1F44"), 0.63, 0.40, 0.50),
    ("Eastbrook Wanderers", "EBW", "Eastbrook", ("#C8102E", "#1D428A"), 0.68, 0.58, 0.30),
    ("Westmoor Albion", "WMA", "Westmoor", ("#2E86C1", "#F4D03F"), 0.58, 0.52, 0.65),
]

FIRST_NAMES = [
    "Mateo", "Lucas", "Kofi", "Ravi", "Jonas", "Thiago", "Yusuf", "Elias", "Kenji", "Amadou",
    "Liam", "Diego", "Sami", "Noah", "Ibrahim", "Tomas", "Andre", "Callum", "Rafael", "Emil",
    "Oskar", "Malik", "Joaquin", "Leon", "Hugo", "Arjun", "Nico", "Felix", "Bruno", "Kai",
    "Santiago", "Isaac", "Omar", "Viktor", "Marco", "Dario", "Jude", "Tariq", "Matias", "Ethan",
]
LAST_NAMES = [
    "Alvarado", "Okafor", "Lindqvist", "Moreau", "Haddad", "Castillo", "Brennan", "Nakamura", "Diallo",
    "Ferreira", "Kowalski", "Mensah", "Varga", "Quintero", "Holm", "Achterberg", "Sorensen", "Benali",
    "Rinaldi", "Oduya", "Marsh", "Delgado", "Petrov", "Asante", "Navarro", "Carvalho", "Eriksen",
    "Toure", "Whitlock", "Ibarra", "Larsen", "Mbeki", "Duarte", "Fontaine", "Kane-Ellis", "Sato",
    "Vidal", "Okonkwo", "Hartley", "Rojas",
]

# 4-3-3: position, role, shirt number, distance per 90 (km)
FORMATION_433 = [
    ("GK", "GK", 1, 5.4),
    ("RB", "DEF", 2, 10.6),
    ("RCB", "DEF", 4, 9.8),
    ("LCB", "DEF", 5, 9.8),
    ("LB", "DEF", 3, 10.6),
    ("CDM", "MID", 6, 11.4),
    ("RCM", "MID", 8, 11.8),
    ("LCM", "MID", 10, 11.6),
    ("RW", "FWD", 7, 10.9),
    ("LW", "FWD", 11, 10.9),
    ("ST", "FWD", 9, 10.3),
]
BENCH = [("GK", "GK", 13, 5.4), ("CB", "DEF", 15, 9.8), ("CM", "MID", 14, 11.4),
         ("CM", "MID", 16, 11.4), ("W", "FWD", 17, 10.9), ("ST", "FWD", 19, 10.3)]

TOP_SPEED_BY_ROLE = {"GK": (27.5, 1.2), "DEF": (32.0, 1.3), "MID": (31.5, 1.3), "FWD": (33.2, 1.3)}


def _player(rng: np.random.Generator, club_short: str, used: set[str], spec) -> Player:
    position, role, number, work_rate = spec
    while True:
        name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}"
        if name not in used:
            used.add(name)
            break
    mu, sd = TOP_SPEED_BY_ROLE[role]
    return Player(
        id=f"{club_short}-{number}",
        name=name,
        number=number,
        position=position,
        role=role,
        top_speed_kmh=round(float(np.clip(rng.normal(mu, sd), 26.0, 36.0)), 1),
        work_rate=round(float(rng.normal(work_rate, 0.35)), 2),
    )


def build_team(index: int, seed: int) -> Team:
    """Build a club with a squad that is stable for a given (club, seed) pair."""
    name, short, city, colors, strength, pressing, directness = CLUBS[index]
    rng = np.random.default_rng(seed * 100 + index)
    used: set[str] = set()
    return Team(
        id=short,
        name=name,
        short_name=short,
        city=city,
        colors=colors,
        formation="4-3-3",
        strength=strength,
        pressing=pressing,
        directness=directness,
        lineup=[_player(rng, short, used, s) for s in FORMATION_433],
        bench=[_player(rng, short, used, s) for s in BENCH],
    )
