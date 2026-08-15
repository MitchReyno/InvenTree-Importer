"""
InvenTree REST client and importers.

    api         connection plus the API 530 model overrides
    parameters  part parameter templates and values: load_parameters

Note this package shadows nothing: the third-party `inventree` library is still
imported absolutely from inside here, since Python 3 resolves plain imports
against sys.path rather than the containing package.
"""
