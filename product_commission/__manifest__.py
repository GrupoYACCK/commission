# -*- coding: utf-8 -*-
{
    'name': "Product Commission",

    'summary': """
        Product Commission""",

    'description': """
        Product Commission for Sales
    """,

    'author': "Grupo YACCK",
    'website': "http://www.grupoyacck.com",
    'category': 'Sales',
    'version': '0.1',
    'depends': ['sale_commission', 'sale'],

    # always loaded
    'data': [
        'security/ir.model.access.csv',
        'views/product_template_view.xml',
    ],
}
