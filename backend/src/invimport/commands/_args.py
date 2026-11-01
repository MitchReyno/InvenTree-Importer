"""Argparse fragments shared by the CLI commands."""

from __future__ import annotations

import argparse
from pathlib import Path


def add_output_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--json", type=Path, default=None, metavar="PATH",
                        help="write the extracted results to a JSON file")
    parser.add_argument("--raw", action="store_true",
                        help="dump the raw API payload for each result")


def add_digikey_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--sandbox", action="store_true",
                        help="use the sandbox API - returns fabricated data, never "
                             "use against a real database")
    parser.add_argument("--refresh", action="store_true",
                        help="ignore any cached response and refetch")
