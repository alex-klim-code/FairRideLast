import { START_FEE, rates, fare } from './pricing';
export { START_FEE, rates, fare } from './pricing';

export type Role = 'USER' | 'CONDUCTOR' | 'ADMIN';
export type TransportType = 'BUS' | 'TRAM' | 'METRO' | 'TRAIN';
export type CheckInStatus = 'AVAILABLE' | 'LOCKED';
export interface User { id:string; role:Role; firstName:string; lastName:string; email:string; phone:string; address:string; postalCode:string }
export interface Stop { id:string; name:string; type:string; lat:number; lng:number; departures:string[] }
export interface TransportLine { id:string; type:TransportType; lineNumber:string; destination:string; vehicleIds:string[]; stopIds:string[] }
export interface Vehicle { id:string; lineId:string; type:TransportType; lineNumber:string; destination:string; lat:number; lng:number; status:string; passengers:number; checkInStatus:CheckInStatus; ratePerKm:number }
export interface Journey { id:string; passengerId:string; vehicleId:string; startingStopId:string; startLocation:string; checkedInAt:string; currentLocation:string; distanceKm:number; status:'ACTIVE'|'COMPLETED'; checkedOutAt?:string; destinationStopId?:string; durationSeconds?:number; finalPrice?:number; startFee?:number; ratePerKm?:number }
export interface PaymentMethod { brand:string; lastFour:string; expiryMonth:string; expiryYear:string; simulated:true }
export interface DemoState { users:User[]; vehicles:Vehicle[]; journeys:Journey[]; payment:PaymentMethod; selectedVehicleId:string; selectedStopId:string; }
export const stops:Stop[]=[
 {id:'stop-rynek',name:'Teatr Bagatela',type:'Tram · Bus',lat:50.0639,lng:19.9332,departures:['4 min','9 min','13 min']},
 {id:'stop-dworzec',name:'Dworzec Główny',type:'Tram · Bus · Rail',lat:50.0674,lng:19.9471,departures:['2 min','7 min','12 min']},
 {id:'stop-wawel',name:'Wawel',type:'Tram',lat:50.0541,lng:19.9352,departures:['6 min','11 min','18 min']},
 {id:'stop-kazimierz',name:'Plac Wolnica',type:'Tram · Bus',lat:50.0487,lng:19.9444,departures:['3 min','10 min','16 min']},
 {id:'stop-politechnika',name:'Politechnika',type:'Tram · Bus',lat:50.0735,lng:19.9447,departures:['5 min','8 min','15 min']},
 {id:'stop-bernatka',name:'Most Kotlarski',type:'Tram · Bus',lat:50.0484,lng:19.9609,departures:['7 min','14 min','20 min']},
];
const initialVehicles:Vehicle[]=[
 {id:'vehicle-52-01',lineId:'line-52',type:'TRAM',lineNumber:'52',destination:'Czerwone Maki',lat:50.0615,lng:19.9399,status:'In service',passengers:18,checkInStatus:'AVAILABLE',ratePerKm:rates.TRAM},
 {id:'vehicle-4-02',lineId:'line-4',type:'TRAM',lineNumber:'4',destination:'Bronowice Małe',lat:50.0652,lng:19.9302,status:'In service',passengers:31,checkInStatus:'AVAILABLE',ratePerKm:rates.TRAM},
 {id:'vehicle-18-03',lineId:'line-18',type:'TRAM',lineNumber:'18',destination:'Krowodrza Górka',lat:50.0528,lng:19.9425,status:'In service',passengers:12,checkInStatus:'LOCKED',ratePerKm:rates.TRAM},
 {id:'vehicle-124-04',lineId:'line-124',type:'BUS',lineNumber:'124',destination:'TAURON Arena',lat:50.0578,lng:19.9524,status:'In service',passengers:9,checkInStatus:'AVAILABLE',ratePerKm:rates.BUS},
 {id:'vehicle-502-05',lineId:'line-502',type:'BUS',lineNumber:'502',destination:'Aleja Przyjaźni',lat:50.0713,lng:19.9519,status:'In service',passengers:22,checkInStatus:'AVAILABLE',ratePerKm:rates.BUS},
 {id:'vehicle-3-06',lineId:'line-3',type:'TRAM',lineNumber:'3',destination:'Nowy Bieżanów',lat:50.0473,lng:19.9366,status:'In service',passengers:14,checkInStatus:'AVAILABLE',ratePerKm:rates.TRAM},
];
export const lines:TransportLine[]=[
 {id:'line-52',type:'TRAM',lineNumber:'52',destination:'Czerwone Maki',vehicleIds:['vehicle-52-01'],stopIds:['stop-dworzec','stop-rynek','stop-wawel']},
 {id:'line-4',type:'TRAM',lineNumber:'4',destination:'Bronowice Małe',vehicleIds:['vehicle-4-02'],stopIds:['stop-politechnika','stop-dworzec','stop-rynek']},
 {id:'line-18',type:'TRAM',lineNumber:'18',destination:'Krowodrza Górka',vehicleIds:['vehicle-18-03'],stopIds:['stop-kazimierz','stop-rynek','stop-politechnika']},
 {id:'line-124',type:'BUS',lineNumber:'124',destination:'TAURON Arena',vehicleIds:['vehicle-124-04'],stopIds:['stop-wawel','stop-kazimierz','stop-bernatka']},
 {id:'line-502',type:'BUS',lineNumber:'502',destination:'Aleja Przyjaźni',vehicleIds:['vehicle-502-05'],stopIds:['stop-politechnika','stop-dworzec']},
 {id:'line-3',type:'TRAM',lineNumber:'3',destination:'Nowy Bieżanów',vehicleIds:['vehicle-3-06'],stopIds:['stop-rynek','stop-wawel','stop-kazimierz']},
];
const defaultState:DemoState={users:[],vehicles:initialVehicles,journeys:[],payment:{brand:'Visa test',lastFour:'4242',expiryMonth:'08',expiryYear:'2028',simulated:true},selectedVehicleId:'vehicle-52-01',selectedStopId:'stop-rynek'};
const KEY='metromate-demo-v1';
export function readState():DemoState {
 try {
  const raw=localStorage.getItem(KEY);
  if(raw){
   const saved=JSON.parse(raw) as Partial<DemoState>;
   const previousVehicles=saved.vehicles?.length?saved.vehicles:initialVehicles;
   // Snapshot legacy prices before refreshing the fleet tariff; never reprice old rides.
   const journeys=(saved.journeys??[]).map(journey=>({...journey,
    startFee:journey.startFee??0,
    ratePerKm:journey.ratePerKm??previousVehicles.find(vehicle=>vehicle.id===journey.vehicleId)?.ratePerKm??rates.TRAM,
   }));
   return {...defaultState,...saved,journeys,vehicles:previousVehicles.map(vehicle=>({...vehicle,ratePerKm:rates[vehicle.type]}))};
  }
 } catch{}
 return structuredClone(defaultState);
}
export function saveState(state:DemoState){localStorage.setItem(KEY,JSON.stringify(state));}
export function newJourney(userId:string,vehicle:Vehicle,stop:Stop):Journey { const now=new Date().toISOString();return {id:`ride-${Date.now()}`,passengerId:userId,vehicleId:vehicle.id,startingStopId:stop.id,startLocation:stop.name,checkedInAt:now,currentLocation:stop.name,distanceKm:0,status:'ACTIVE',startFee:START_FEE,ratePerKm:vehicle.ratePerKm}; }
export function formatMoney(amount:number){return new Intl.NumberFormat('pl-PL',{style:'currency',currency:'PLN'}).format(amount);}
export function formatDuration(seconds:number){const min=Math.floor(seconds/60),sec=seconds%60;return `${min} min ${sec.toString().padStart(2,'0')} s`;}
export function advanceJourneyDistances(state:DemoState,kmPerSecond=.004):DemoState {
 let hasRide=false;
 const journeys=state.journeys.map(j=>{if(j.status!=='ACTIVE')return j;hasRide=true;return {...j,distanceKm:Math.round((j.distanceKm+kmPerSecond)*1000)/1000};});
 return hasRide?{...state,journeys}:state;
}
export function beginJourney(state:DemoState,passengerId:string,vehicleId:string,stopId:string):{state:DemoState;journey?:Journey;error?:string}{
 if(state.journeys.some(j=>j.passengerId===passengerId&&j.status==='ACTIVE'))return {state,error:'You already have an active ride. Check out before starting another.'};
 const vehicle=state.vehicles.find(v=>v.id===vehicleId),start=stops.find(s=>s.id===stopId);
 if(!vehicle||!start)return {state,error:'Choose a valid vehicle and starting stop.'};
 if(vehicle.checkInStatus==='LOCKED')return {state,error:`Check-in is locked on line ${vehicle.lineNumber}. Choose another vehicle.`};
 const journey=newJourney(passengerId,vehicle,start);
 return {state:{...state,selectedVehicleId:vehicle.id,selectedStopId:start.id,journeys:[journey,...state.journeys]},journey};
}
export function finishJourney(state:DemoState,journeyId:string,destinationStopId:string,now=new Date()):{state:DemoState;receipt?:Journey}{
 const ride=state.journeys.find(j=>j.id===journeyId&&j.status==='ACTIVE');
 if(!ride)return {state};
 const vehicle=state.vehicles.find(v=>v.id===ride.vehicleId);
 const elapsed=Math.max(0,Math.floor((now.getTime()-new Date(ride.checkedInAt).getTime())/1000));
 const destination=stops.find(s=>s.id===destinationStopId);
 const receipt:Journey={...ride,status:'COMPLETED',checkedOutAt:now.toISOString(),destinationStopId,currentLocation:destination?.name??ride.currentLocation,durationSeconds:elapsed,finalPrice:fare(ride.distanceKm,ride.ratePerKm??vehicle?.ratePerKm??rates.TRAM,ride.startFee??0)};
 return {state:{...state,journeys:state.journeys.map(j=>j.id===ride.id?receipt:j)},receipt};
}
export function toggleVehicleLock(state:DemoState,vehicleId:string):{state:DemoState;changed:boolean;locked:boolean}{
 const vehicle=state.vehicles.find(v=>v.id===vehicleId);
 if(!vehicle)return {state,changed:false,locked:false};
 const unlock=vehicle.checkInStatus==='LOCKED';
 if(!unlock&&state.vehicles.some(v=>v.id!==vehicleId&&v.checkInStatus==='LOCKED'))return {state,changed:false,locked:false};
 return {state:{...state,vehicles:state.vehicles.map(v=>v.id===vehicleId?{...v,checkInStatus:unlock?'AVAILABLE':'LOCKED'}:v)},changed:true,locked:!unlock};
}