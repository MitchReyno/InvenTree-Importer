"""
InvenTree REST client and importers.

    api         connection plus the API 530 model overrides
    parameters  part parameter templates, from config/parameters.yaml
    categories  part categories, from config/categories.yaml
    values      parse DigiKey values and format them for InvenTree

Note this package shadows nothing: the third-party `inventree` library is still
imported absolutely from inside here, since Python 3 resolves plain imports
against sys.path rather than the containing package.
"""
