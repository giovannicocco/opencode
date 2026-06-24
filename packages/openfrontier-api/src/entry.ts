import app, { UserGate } from "./index"
import { billingRoutes } from "./billing-routes"

app.route("/v1", billingRoutes)

export { UserGate }
export default app
