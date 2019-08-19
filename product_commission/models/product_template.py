# -*- coding: utf-8 -*-

from odoo import models, fields, api, _
from odoo.exceptions import ValidationError


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    product_commission_ids = fields.One2many("product.commission.agent", "product_id",
                                             "Commission Agents")


class ProductProduct(models.Model):
    _inherit = 'product.product'

    @api.multi
    def get_commission_by_product(self, agent_id):
        if not self:
            return False
        self.ensure_one()
        # commission_id = False
        # if agent_id:
        #    commission_id = self.env['product.commission.agent'].search([('product_id','=',self.product_tmpl_id.id)], limit = 1)
        # else:
        commission_id = self.env['product.commission.agent'].search([('product_id', '=', self.product_tmpl_id.id),
                                                                     ('agent_id', '=', agent_id)],
                                                                    limit=1).commission_id.id
        if not commission_id:
            commission_id = self.env['product.commission.agent'].search([('product_id', '=', self.product_tmpl_id.id)],
                                                                        limit=1).commission_id.id
        return commission_id


class ProductCommissionAgent(models.Model):
    _name = 'product.commission.agent'

    product_id = fields.Many2one("product.template", "Product")
    commission_id = fields.Many2one("sale.commission", "Commission", required=True)
    agent_id = fields.Many2one('res.partner', "Agent", domain=[('agent', '=', True)])

    @api.constrains("commission_id")
    def check_commission_id(self):
        for product_commission_id in self:
            commission = self.search([("commission_id", "=", product_commission_id.commission_id.id),
                                      ('product_id', "=", product_commission_id.product_id.id),
                                      ("agent_id", "=", False)])
            if len(commission) > 1:
                raise ValidationError(_("You can only have a general commission per product"))
            commission_product = self.search([("commission_id", "=", product_commission_id.commission_id.id),
                                              ('product_id', "=", product_commission_id.product_id.id),
                                              ("agent_id", "=", product_commission_id.agent_id.id)])
            commission_agent = self.search([('product_id', "=", product_commission_id.product_id.id),
                                            ("agent_id", "=", product_commission_id.agent_id.id)])
            if len(commission_product) > 1 or len(commission_agent) > 1:
                raise ValidationError(_("You can only have one commission per product and agent"))
