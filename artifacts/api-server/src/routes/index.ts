import { Router, type IRouter } from "express";
import healthRouter from "./health";
import geocodingRouter from "./geocoding";
import transitRouter from "./transit";
import transportRouter from "./transport";
import passengerStopsRouter from "./passenger-stops";

const router: IRouter = Router();

router.use(healthRouter);
router.use(geocodingRouter);
router.use(transitRouter);
router.use(transportRouter);
router.use(passengerStopsRouter);

export default router;
