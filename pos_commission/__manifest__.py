# -*- coding: utf-8 -*-
{
    'name': "POS Commission",

    'summary': """
        POS Commission""",

    'description': """
        POS Commission
    """,

    'author': "Grupo YACCK",
    'website': "http://www.grupoyacck.com",

    # Categories can be used to filter modules in modules listing
    # Check https://github.com/odoo/odoo/blob/11.0/odoo/addons/base/module/module_data.xml
    # for the full list
    'category': 'Sales',
    'version': '0.1',

    # any module necessary for this one to work correctly
    'depends': ['sale_commission', 'product_commission', 'point_of_sale', 'account_accountant',
    'pos_journal_sequence'],

    # always loaded
    'data': [
        # 'security/ir.model.access.csv',
        'views/pos_order_view.xml',
        'views/pos_commission_template.xml'
    ],
    'qweb': [
        'static/src/xml/pos.xml'
    ],
}