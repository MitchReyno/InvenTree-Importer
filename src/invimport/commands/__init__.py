"""
Command modules for the invimport CLI.

Each module is self-contained and exposes the same four names:

    NAME            subcommand name on the CLI
    HELP            one-line help shown in `invimport --help`
    add_arguments   register the subcommand's flags on its parser
    run(args)       do the work, return an exit code

Adding a command means dropping a module here and listing it in COMMANDS.
"""

from . import orders, parameters, product

# Registration order is the order shown in --help.
COMMANDS = [product, orders, parameters]
