# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo import api, models

class SaleOrderLine(models.Model):
    _inherit = "sale.order.line"

    def _prepare_agents_vals(self):
        res = super(SaleOrderLine, self)._prepare_agents_vals()
        return res

class SaleOrderLineAgent(models.Model):
    _inherit = "sale.order.line.agent"
    
    @api.onchange('agent')
    def onchange_agent(self):
        commision = False
        active_model = self.env.context.get('active_model')
        active_id = self.env.context.get('active_id')
        if active_model and active_id:
            order_line = self.env[active_model].browse([active_id])
            if order_line.product_id:
                commision = order_line.product_id.get_commission_by_product(self.agent.id)
        if self.object_id.product_id and not commision:
            commision = self.object_id.product_id.product_id.get_commission_by_product(self.agent.id)
        if commision:
            self.commission = commision
        else:
            super(SaleOrderLineAgent, self).onchange_agent()
