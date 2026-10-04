import { useEffect, useRef, useState } from 'react';
import { Link, Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { useClerk } from '@clerk/react';
import { Activity, ArrowLeft, ArrowRight, Bus, Check, ChevronDown, CreditCard, LogOut, MapPin, Navigation, Search, ShieldCheck, TramFront, TrainFront, UserRound, Users, Wallet, X } from 'lucide-react';
import { DemoState, Journey, PaymentMethod, Role, Stop, TransportType, Vehicle, advanceJourneyDistances, beginJourney, fare, finishJourney, formatDuration, formatMoney, lines, rates, readState, saveState, stops, toggleVehicleLock } from './services/demo';
import { closestStopTo, type RoutePoint } from './services/routing';
import { useDeviceLocation } from './hooks/use-device-location';
import { useDestinationHistory } from './hooks/use-destination-history';
import { DestinationSearch } from './components/DestinationSearch';
import { PricesPage } from './components/PricesPage';
import { TransitDirections } from './components/TransitDirections';
import { GoogleTransitMap } from './components/GoogleTransitMap';
import type { TransitRoute } from '@workspace/api-client-react';
import { MapLegal } from './components/MapLegal';
import { PassengerExperience } from './components/passenger/PassengerExperience';
import { ConductorTransportPage, InspectionHistoryPage, AdminTransportPage } from './components/transport';
import { selectDemoTransportRole, clearDemoTransportRole, transportError, demoRequestOptions } from './services/transport-session';
import { getDemoTransportSession } from '@workspace/api-client-react';
import { TransportModeContext, useTransportMode } from './services/transport-mode';
import { useVerifiedTransportAccount } from './hooks/use-verified-transport-account';
import { AccountAuthProvider, AccountSignIn, AccountSignUp } from './components/AccountAuth';
import { StaffPermissionsPage } from './components/StaffPermissionsPage';
import type { User } from './services/demo';
import { useTransportWorkspace } from './hooks/use-transport-workspace';
import './index.css';
import { HomePage } from './components/HomePage';
import { DemoLoginPage } from './components/DemoLoginPage';
import { NativeMapPage } from './components/NativeMapPage';

const pathForRole=(role:Role)=>role==='USER'?'/user/map':role==='CONDUCTOR'?'/conductor/vehicles':'/admin/overview';
const navByRole:Record<Role,{label:string;path:string;icon:any}[]>={USER:[{label:'Explore',path:'/user/map',icon:MapPin},{label:'My rides',path:'/user/journeys',icon:Activity},{label:'Active ride',path:'/user/ticket',icon:Wallet},{label:'Profile',path:'/user/profile',icon:UserRound}],CONDUCTOR:[{label:'Vehicles',path:'/conductor/vehicles',icon:Bus},{label:'Inspect',path:'/conductor/inspection',icon:ShieldCheck},{label:'Profile',path:'/conductor/profile',icon:UserRound}],ADMIN:[{label:'Overview',path:'/admin/overview',icon:Activity},{label:'Fleet',path:'/admin/vehicles',icon:Bus}]};
const roleNames:Record<Role,string>={USER:'Passenger',CONDUCTOR:'Conductor',ADMIN:'Admin'};
const typeLabel=(type:TransportType)=>({TRAM:'Tram',BUS:'Bus',METRO:'Metro',TRAIN:'Train'}[type]);

function App({ verifiedUser, onVerifiedSignOut }: { verifiedUser?: User; onVerifiedSignOut?: () => Promise<unknown> }){
 const mode=useTransportMode();
 const [state,setState]=useState<DemoState>(()=>readState());
 const [location,setLocation]=useLocation();
 useEffect(()=>{
  const home=location==='/home';
  const title=home?'FairRide — wygodniej po Krakowie':location==='/login'?'FairRide — konto testowe':'FairRide';
  const description=home?'Planuj przejazd z GPS, porównuj połączenia i dojścia piesze oraz sprawdzaj szacowany koszt FairRide.':location==='/login'?'Wybierz konto testowe pasażera, konduktora lub administratora FairRide. Bez hasła i prawdziwych płatności.':'FairRide: wybierz trasę i transport, zrób check-in i rozlicz kilometry GPS przy check-out.';
  document.title=title;
  document.documentElement.lang=home||location==='/login'?'pl':'en';
  for(const [selector,value] of [
   ['meta[name="description"]',description],['meta[property="og:title"]',title],
   ['meta[property="og:description"]',description],['meta[name="twitter:title"]',title],
   ['meta[name="twitter:description"]',description],
  ]) document.querySelector<HTMLMetaElement>(selector)?.setAttribute('content',value);
 },[location]);
 const [toast,setToast]=useState('');
 const [search,setSearch]=useState('');
 const [selectedMapVehicle,setSelectedMapVehicle]=useState('');
 const [cardModal,setCardModal]=useState(false);
 const [lastReceipt,setLastReceipt]=useState<Journey|null>(null);
 const [tick,setTick]=useState(Date.now());
 const [roleBusy,setRoleBusy]=useState(false);
 const rolePending=useRef(false);
 const user=mode==='verified'?verifiedUser:state.users[0];
 useEffect(()=>{
  if(mode!=='demo')return;
  let disposed=false;
  getDemoTransportSession(demoRequestOptions).then(actor=>{
   if(!disposed)setState(s=>({...s,users:s.users[0]?.role===actor.role?s.users:[]}));
  }).catch(()=>{if(!disposed)setState(s=>({...s,users:[]}));});
  return()=>{disposed=true;};
 },[mode]);
 const {location:geo,status:geoStatus,error:geoError,requestLocation:requestPosition}=useDeviceLocation(user?.role==='USER'&&location!=='/home'&&location!=='/login');
 useEffect(()=>saveState(state),[state]);
 useEffect(()=>{const t=setInterval(()=>{setTick(Date.now());setState(previous=>advanceJourneyDistances(previous));},1000);return()=>clearInterval(t);},[]);
 useEffect(()=>{if(!toast)return undefined;const t=setTimeout(()=>setToast(''),2800);return()=>clearTimeout(t);},[toast]);
 const flash=(message:string)=>setToast(message);
 const changeState=(fn:(s:DemoState)=>DemoState)=>setState(prev=>fn(prev));
 const signIn=async(role:Role)=>{
  if(rolePending.current)return;
  rolePending.current=true;setRoleBusy(true);
  try {
   await selectDemoTransportRole(role);
  const people:Record<Role,DemoState['users'][number]>={USER:{id:'passenger-demo',role,firstName:'Maja',lastName:'Kowalska',email:'maja.kowalska@example.test',phone:'+48 600 412 830',address:'ul. Starowiślna 12',postalCode:'31-032'},CONDUCTOR:{id:'conductor-demo',role,firstName:'Tomasz',lastName:'Nowak',email:'tomasz.nowak@example.test',phone:'+48 600 311 940',address:'Kraków',postalCode:'30-001'},ADMIN:{id:'admin-demo',role,firstName:'Aleksandra',lastName:'Zielińska',email:'ola.admin@example.test',phone:'+48 600 555 240',address:'Kraków',postalCode:'30-001'}};
  changeState(s=>({...s,users:[people[role]]}));setLocation(pathForRole(role));
  } catch(error) { flash(transportError(error)); }
  finally {rolePending.current=false;setRoleBusy(false);}
 };
 const signOut=async()=>{if(rolePending.current)return;rolePending.current=true;try{
  if(mode==='verified'){await onVerifiedSignOut?.();return;}
  await clearDemoTransportRole();changeState(s=>({...s,users:[]}));setLocation('/');
 }catch(error){flash(transportError(error));}finally{rolePending.current=false;}};
 const stop=stops.find(s=>s.id===state.selectedStopId)??stops[0];
 const activeRide=state.journeys.find(j=>j.passengerId===user?.id&&j.status==='ACTIVE');
 const selectedVehicle=state.vehicles.find(v=>v.id===state.selectedVehicleId)??state.vehicles[0];
 const startRide=(vehicle:Vehicle,startingStop=stop)=>{
  if(!user)return;
  const result=beginJourney(state,user.id,vehicle.id,startingStop.id);
  if(result.error){flash(result.error);return;}
  changeState(()=>result.state);
  flash(`Checked in on line ${vehicle.lineNumber}. Your fare is distance-based.`);setLocation('/user/ticket');
 };
 const checkOut=()=>{
  if(!activeRide)return;
  const result=finishJourney(state,activeRide.id,stop.id);
  if(!result.receipt)return;
  changeState(()=>result.state);setLastReceipt(result.receipt);flash('Ride checked out. Your receipt is ready.');
 };
 const selectStop=(s:Stop)=>{changeState(prev=>({...prev,selectedStopId:s.id}));flash(`${s.name} selected`);};
 const currentPath=location;

 if(location==='/'&&user) return <Redirect to={pathForRole(user.role)} replace />;
 if(location==='/home') return <HomePage appPath={user?pathForRole(user.role):'/login'} />;
  if(!user&&['/prices','/privacy','/terms'].includes(location)){
   return <div className="app-shell"><header className="topbar"><Link href="/login" className="brand"><span className="brand-mark"><Navigation size={19}/></span>FairRide</Link><div className="top-actions"><Link href="/prices" className="nav-link active" data-testid="link-header-prices">Prices</Link><Link href="/login" className="btn btn-secondary">Choose view</Link></div></header><main className="content">{location==='/prices'?<PricesPage/>:<MapLegal kind={location==='/privacy'?'privacy':'terms'}/>}</main></div>;
 }
  if(mode==='verified'&&location==='/login')return <div className="surface pad"><h1>Verified account</h1><p>You are already signed in. Open your account, or sign out to choose another view.</p><Link href={pathForRole(user!.role)} className="btn">Open your account</Link></div>;
 if(!user||location==='/login'){
  return <><DemoLoginPage onChoose={signIn} busy={roleBusy}/>{toast&&<div className="toast-msg" role="status">{toast}</div>}</>;
 }
 if(user.role==='USER'){return <><PassengerExperience key={user.id} user={user} geo={geo} geoStatus={geoStatus} geoError={geoError} requestPosition={requestPosition} signOut={signOut}/>{toast&&<div className="toast-msg" role="status">{toast}</div>}</>;}
 const nav=mode==='verified'&&user.role==='ADMIN'?[...navByRole.ADMIN,{label:'Staff',path:'/admin/staff',icon:Users}]:navByRole[user.role];
 const titleByPath:Record<string,string>={'/user/map':'Find your ride','/user/journeys':'Ride history','/user/ticket':'Your ride','/user/profile':'Your profile','/conductor/vehicles':'Vehicle check-in','/conductor/inspection':'Ride inspection','/conductor/profile':'Conductor profile','/admin/overview':'Network overview','/admin/vehicles':'Lines & vehicles'};
 const header=<header className="topbar">
  <Link href={pathForRole(user.role)} className="brand" data-testid="link-brand"><span className="brand-mark"><Navigation size={19}/></span><span>FairRide</span></Link>
  <nav className="desktop-links" aria-label="Main navigation">{nav.map(({label,path,icon:Icon})=><Link key={path} href={path} className={`nav-link ${currentPath===path?'active':''}`} data-testid={`link-nav-${path.split('/').pop()}`}><Icon size={16}/>{label}</Link>)}</nav>
   <div className="top-actions"><Link href="/prices" className={`nav-link header-prices ${currentPath==='/prices'?'active':''}`} data-testid="link-header-prices">Prices</Link><span className="role-name">{roleNames[user.role]} · {mode==='demo'?'DEMO':'Verified'}</span><button className="icon-btn" onClick={signOut} aria-label="Sign out" title="Sign out" data-testid="button-sign-out"><LogOut size={17}/></button></div>
 </header>;
 const shared={state,changeState,flash,user,stop,activeRide,selectedVehicle,startRide,checkOut,requestPosition,geo,geoStatus,geoError,tick,setCardModal,lastReceipt,setLastReceipt,search,setSearch,selectStop};
  return <div className="app-shell">{header}<main className="content fade-in" key={`${mode}:${user.id}:${user.role}`}>
   <div className="notice" style={{marginBottom:18}} data-testid="transport-mode-banner">{mode==='demo'?'Isolated DEMO · mock fleet only. These controls cannot affect live operations.':`Verified account · ${user.firstName} · server-managed ${roleNames[user.role]} permissions.`}</div>
  <Switch>
   <Route path="/user/map"><MapPage {...shared} selectedMapVehicle={selectedMapVehicle} setSelectedMapVehicle={setSelectedMapVehicle}/></Route>
   <Route path="/user/journeys"><JourneyPage {...shared}/></Route>
   <Route path="/user/ticket"><TicketPage {...shared}/></Route>
   <Route path="/user/profile"><ProfilePage {...shared}/></Route>
   <Route path="/conductor/vehicles">{user.role==='CONDUCTOR'?<ConductorTransportPage/>:<div className="notice">Choose the Conductor demo view to open this page.</div>}</Route>
   <Route path="/conductor/inspection">{user.role==='CONDUCTOR'?<InspectionHistoryPage/>:<div className="notice">Choose the Conductor demo view to open this page.</div>}</Route>
    <Route path="/conductor/profile">{user.role==='CONDUCTOR'?(mode==='demo'?<ConductorProfile {...shared}/>:<section className="surface pad"><h1>{user.firstName} {user.lastName}</h1><p>{user.email}</p><p>Conductor · verified account</p><p className="tiny muted">Ownership ID: {user.id}</p></section>):<div className="notice">Conductor access required.</div>}</Route>
   <Route path="/admin/overview">{user.role==='ADMIN'?<AdminTransportPage/>:<div className="notice">Choose the Admin demo view to open this page.</div>}</Route>
   <Route path="/admin/vehicles">{user.role==='ADMIN'?<AdminTransportPage fleetOnly/>:<div className="notice">Choose the Admin demo view to open this page.</div>}</Route>
    <Route path="/admin/staff">{mode==='verified'&&user.role==='ADMIN'?<StaffPermissionsPage/>:<div className="notice">Verified Admin access required.</div>}</Route>
   <Route path="/prices"><PricesPage/></Route>
    <Route path="/privacy"><MapLegal kind="privacy"/></Route>
    <Route path="/terms"><MapLegal kind="terms"/></Route>
   <Route><div className="empty-state surface"><h2>That stop isn't on our map</h2><p>Choose a page from the navigation.</p><Link href={pathForRole(user.role)} className="btn">Back to your dashboard</Link></div></Route>
  </Switch>
  </main>
  <footer style={{padding:'12px 24px 80px',textAlign:'center',fontSize:12}}><Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link></footer>
 <nav className="mobile-nav" aria-label="Mobile navigation">{nav.map(({label,path,icon:Icon})=><Link key={path} href={path} className={`nav-link ${currentPath===path?'active':''}`} data-testid={`mobile-nav-${path.split('/').pop()}`}><Icon size={18}/><span>{label}</span></Link>)}</nav>
 {cardModal&&<CardDialog payment={state.payment} onClose={()=>setCardModal(false)} onSave={payment=>{changeState(s=>({...s,payment}));setCardModal(false);flash('Demo card details saved.');}}/>}
 {toast&&<div className="toast-msg" role="status" data-testid="status-toast">{toast}</div>}
 </div>;
}

function Login({onChoose,busy=false}:{onChoose:(role:Role)=>void|Promise<void>;busy?:boolean}){
 const roles:{role:Role;title:string;description:string;icon:any;hint:string}[]=[
  {role:'USER',title:'Passenger',description:'Find a nearby vehicle and pay only for the distance you travel.',icon:UserRound,hint:'Ride at your own pace'},
  {role:'CONDUCTOR',title:'Conductor',description:'Manage check-in access and inspect active, anonymous rides.',icon:ShieldCheck,hint:'Vehicle operations'},
  {role:'ADMIN',title:'Admin',description:'See how Kraków moves, from the fleet to the fare mix.',icon:Activity,hint:'Network overview'},
 ];
 return <div className="login-shell">
  <Link href="/prices" className="nav-link login-prices" data-testid="link-login-prices">Prices</Link>
   <section className="login-intro"><div><Link href="/login" className="brand" style={{color:'#f7f2e8'}}><span className="brand-mark" style={{background:'#e6b65e',color:'#1c5947'}}><Navigation size={19}/></span><span>FairRide</span></Link><div className="eyebrow" style={{color:'#a9cdb8',marginTop:54}}>KRAKÓW · FAIR FARE TRANSIT</div><h1>Your ride.<br/>Your distance.<br/><span style={{color:'#ecc36e'}}>Your fare.</span></h1><p>A simpler way around Kraków. Check in when you board, check out when you arrive — you only pay for the kilometres in between.</p></div><div className="login-foot tiny" style={{color:'#b9d0c2'}}>FairRide — for the way our city moves.<br/><Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link></div></section>
  <section className="login-main"><div className="role-list fade-in"><div className="eyebrow">FAIRRIDE</div><h2 style={{fontSize:29,marginBottom:2}}>Choose your view</h2><p className="subheading" style={{marginBottom:11}}>Public demo, not verified staff authentication. Pick a role to explore.</p>{roles.map(({role,title,description,icon:Icon,hint})=><button type="button" className="role-card" disabled={busy} onClick={()=>onChoose(role)} key={role} data-testid={`button-login-${role.toLowerCase()}`}><span className="role-icon"><Icon size={21}/></span><span style={{flex:1}}><strong style={{display:'block',fontSize:14}}>{title}</strong><span className="tiny muted" style={{display:'block',lineHeight:1.5,marginTop:3}}>{description}</span></span><span style={{color:'#86938a'}}><ArrowRight size={18}/></span><span style={{display:'none'}}>{hint}</span></button>)}<div className="notice" style={{marginTop:8}}>Payments and account data are simulated. No real charges are made.{busy?' Opening demo session…':''}</div></div></section>
 </div>;
}

function Heading({eyebrow,title,subtitle,action}:{eyebrow:string;title:string;subtitle?:string;action?:any}){
 return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{subtitle&&<p className="subheading">{subtitle}</p>}</div>{action}</div>;
}
function TransportIcon({type}:{type:TransportType}){return type==='BUS'?<Bus size={17}/>:type==='TRAIN'?<TrainFront size={17}/>:<TramFront size={17}/>;}
function MapPage(p:any){
 const history=useDestinationHistory();
 const [destination,setDestination]=useState<RoutePoint|null>(null);
 const [pickOnMap,setPickOnMap]=useState(false);
 const [liveRoute,setLiveRoute]=useState<TransitRoute|null>(null);
 const vehicles:Vehicle[]=p.state.vehicles;
 const active=p.activeRide;
 const origin:RoutePoint|null=p.geo?{name:'Your location',lat:p.geo.lat,lng:p.geo.lng}:null;
 const chooseDestination=(point:RoutePoint)=>{
  history.remember(point);
  setLiveRoute(null);setDestination(point);setPickOnMap(false);p.setSelectedMapVehicle('');
  const nearest=point.stopId?stops.find((s:Stop)=>s.id===point.stopId)??closestStopTo(point):closestStopTo(point);
  p.changeState((state:DemoState)=>({...state,selectedStopId:nearest.id}));
  p.flash(`Destination selected: ${point.name}`);
 };
 const chooseMapPoint=(point:{lat:number;lng:number})=>chooseDestination({name:'Selected point on map',...point});
 const clearDestination=()=>{setLiveRoute(null);setDestination(null);setPickOnMap(false);p.setSelectedMapVehicle('');};
 return <><Heading eyebrow="NEARBY IN KRAKÓW" title="Find your ride" subtitle="Choose where you're going first. Then see the transit options that can get you there." action={<button className="btn btn-secondary" onClick={p.requestPosition} disabled={p.geoStatus==='loading'} data-testid="button-locate"><Navigation size={16}/> {p.geoStatus==='loading'?'Finding your location…':p.geo?'Refresh my location':'Locate me'}</button>}/>
  {!origin&&<div className="notice" style={{marginBottom:17}} role="status" data-testid="status-device-location">{p.geoStatus==='loading'?'Waiting for your device’s real location. Allow location access when Chrome asks.':p.geoError||'Your location has not been shared yet. Use Locate me to allow location access.'}<div style={{marginTop:5}}>The map currently shows a browsing area, not your location. No substitute position is used for route planning.</div></div>}
  {active&&<div className="notice" style={{marginBottom:17,display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}><span><strong>You're riding line {vehicles.find((v:Vehicle)=>v.id===active.vehicleId)?.lineNumber}.</strong> Your fare is adding up by distance, not by time.</span><Link href="/user/ticket" className="btn" style={{padding:'8px 12px'}}>View ride</Link></div>}
  <div className="map-layout">
    <div className="map-frame" data-testid="map-frame-google"><GoogleTransitMap origin={origin&&p.geo?{lat:origin.lat,lng:origin.lng,accuracy:p.geo.accuracy}:null} destination={destination} stops={[]} pickEnabled={pickOnMap} onPick={chooseMapPoint} onStop={()=>{}} routePolyline={liveRoute?.polyline??null}/>
     <div className="map-overlay" style={{flexDirection:'column',alignItems:'flex-start'}}>
      <DestinationSearch destination={destination} onChoose={chooseDestination} onClear={clearDestination}
       recentDestinations={history.entries} historyError={history.error} onRemoveRecent={history.remove} onClearHistory={history.clear}/>
      <button type="button" className={`btn ${pickOnMap?'pick-active':'btn-secondary'}`} onClick={()=>setPickOnMap(value=>!value)} data-testid="button-pick-map-point"><MapPin size={15}/>{pickOnMap?'Tap the map to set your destination':'Choose a map point'}</button>
     </div>
   </div>
    <section className="surface vehicle-panel route-panel">
     <div className="vehicle-panel-head"><div className="eyebrow">FAIRRIDE · ROUTE PLANNER</div><div className="tiny muted" style={{marginTop:6}} data-testid="text-transit-provider">Rzeczywiste połączenia transportu publicznego z Google Maps.</div><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,marginTop:4}}><h2 style={{margin:0}}>Plan a route</h2>{destination&&<button type="button" className="btn-quiet route-clear" onClick={clearDestination} data-testid="button-reset-route">Reset</button>}</div>
      <div className="route-location" data-testid="text-location-source"><div className="route-location-icon"><Navigation size={15}/></div><div><strong>{origin?'Your location':'Location not available yet'}</strong><small>{origin?`Device location · accuracy ~${Math.round(p.geo.accuracy)} m`:p.geoStatus==='loading'?'Waiting for device location…':'Allow location access to plan a route from your position'}</small></div>{origin&&<span className="route-origin-dot"/>}</div>
      {destination&&<div className="route-location destination-location" data-testid="text-selected-destination"><div className="route-location-icon"><MapPin size={15}/></div><div><strong>{destination.name}</strong><small>Selected destination · {destination.lat.toFixed(5)}, {destination.lng.toFixed(5)}</small></div><button type="button" className="destination-clear inline-clear" onClick={clearDestination} aria-label="Clear destination" data-testid="button-remove-destination"><X size={15}/></button></div>}
     </div>
     {!destination&&<div className="empty-state route-empty"><div className="empty-icon"><Navigation size={21}/></div><h3>Where are you going?</h3><p>Search for an address or select a map point to find real public transport connections from Google Maps.</p></div>}
     {destination&&<TransitDirections origin={origin} destination={destination} selectedRouteId={liveRoute?.id??null} onSelectRoute={setLiveRoute}/>}
   </section>
  </div>
   <div style={{display:'flex',gap:8,alignItems:'center',marginTop:12,flexWrap:'wrap'}}><span className="tiny muted">Map and routes © Google Maps. The Google map receives the area you view; Routes receives coordinates only when you press Wyznacz trasę.</span><a className="tiny muted" href="https://www.geoapify.com/" target="_blank" rel="noreferrer" data-testid="link-search-provider">Powered by Geoapify</a><span className="tiny muted">·</span><span className="tiny muted">{origin?'Location from your device':'Your location is not available — no substitute is shown'}</span></div>
 </>;
}
function JourneyPage(p:any){
 const journeys:Journey[]=p.state.journeys.filter((j:Journey)=>j.passengerId===p.user.id&&j.status==='COMPLETED');
 const [expanded,setExpanded]=useState('');
 const vehicles:Vehicle[]=p.state.vehicles;
 return <><Heading eyebrow="YOUR TRAVEL, CLEARLY" title="Ride history" subtitle="Every trip, every kilometre, every fare — all in one place."/>
 <section className="surface pad">{journeys.length===0
  ?<div className="empty-state"><div className="empty-icon"><Activity size={23}/></div><h2>No rides just yet</h2><p>Your completed rides and itemised receipts will appear here.</p><Link href="/user/map" className="btn">Find a nearby ride</Link></div>
  :<div>{journeys.map(j=>{
   const v=vehicles.find(x=>x.id===j.vehicleId),open=expanded===j.id;
   const rate=j.ratePerKm??v?.ratePerKm??0,startFee=j.startFee??0;
   return <article key={j.id} style={{borderBottom:'1px solid #efede7',padding:'17px 1px'}} data-testid={`journey-card-${j.id}`}>
    <div style={{display:'flex',alignItems:'center',gap:13}}>
     <div className="line-badge">{v?.lineNumber??'—'}</div>
     <div style={{flex:1}}><div style={{fontWeight:700,fontSize:14}}>{j.startLocation} <ArrowRight size={13} style={{verticalAlign:'middle'}}/> {stops.find(s=>s.id===j.destinationStopId)?.name??j.currentLocation}</div>
      <div className="tiny muted" style={{marginTop:5}}>{new Date(j.checkedInAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})} · {v?typeLabel(v.type):'Transit'} · {j.distanceKm.toFixed(1)} km</div></div>
     <strong className="data">{formatMoney(j.finalPrice??0)}</strong>
     <button className="icon-btn" aria-label="Expand receipt" onClick={()=>setExpanded(open?'':j.id)} data-testid={`button-receipt-${j.id}`}><ChevronDown size={17}/></button>
    </div>
    {open&&<div className="fade-in" style={{margin:'17px 4px 3px',padding:16,borderRadius:13,background:'#f3f2eb'}}>
     <div className="eyebrow" style={{marginBottom:12}}>FARE RECEIPT</div>
     <div className="timeline"><span className="dot"/><span>{j.startLocation}</span><span className="route-line"/><MapPin size={14}/><span>{j.currentLocation}</span></div>
     <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginTop:16}}>
      {[['START FEE',formatMoney(startFee)],['DISTANCE',j.distanceKm.toFixed(2)+' km'],['RATE',formatMoney(rate)+' / km'],['TRAVEL TIME',formatDuration(j.durationSeconds??0)],['TOTAL',formatMoney(j.finalPrice??0)]].map(([label,value])=>
       <div className="tiny muted" key={label}>{label}<strong style={{display:'block',color:'#315444',fontSize:14,marginTop:4}}>{value}</strong></div>)}
     </div>
     <p className="tiny muted" style={{margin:'14px 0 0'}}>Demo receipt · {formatMoney(startFee)} + {j.distanceKm.toFixed(2)} km × {formatMoney(rate)} / km</p>
    </div>}
   </article>;
  })}</div>}</section></>;
}
function TicketPage(p:any){
 const ride:Journey|undefined=p.activeRide;
 const vehicle:Vehicle|undefined=ride&&p.state.vehicles.find((v:Vehicle)=>v.id===ride.vehicleId);
 const elapsed=ride?Math.floor((p.tick-new Date(ride.checkedInAt).getTime())/1000):0;
 const rideRate=ride?.ratePerKm??vehicle?.ratePerKm??rates.TRAM;
 const startFee=ride?.startFee??0;
 const cost=ride?fare(ride.distanceKm,rideRate,startFee):0;
 const last=p.lastReceipt as Journey|null;
 return <><Heading eyebrow="LIVE FARE, NO SURPRISES" title="Your ride" subtitle="Your timer is just for information. Your fare follows distance, never time."/>
 {ride&&vehicle?<div className="grid two-col"><section className="ride-card" data-testid="active-ride-card"><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',position:'relative',zIndex:1}}><span className="tag" style={{background:'#ffffff20',color:'#f7f4e9'}}><span style={{width:7,height:7,borderRadius:'50%',background:'#eac16a'}}/> LIVE RIDE</span><span className="tiny" style={{color:'#d6e6dc'}}>DEMO JOURNEY</span></div><div style={{marginTop:28,position:'relative',zIndex:1}}><div className="eyebrow" style={{color:'#bfd6c6'}}>CURRENT FARE</div><div className="ride-price" data-testid="text-live-fare">{formatMoney(cost)}</div><div className="ride-meta">Start fee + distance travelled × vehicle rate</div></div><div style={{display:'flex',gap:35,marginTop:25,position:'relative',zIndex:1}}><div><div className="eyebrow" style={{color:'#bfd6c6'}}>DISTANCE</div><strong className="data" style={{fontSize:19}}>{ride.distanceKm.toFixed(2)} km</strong></div><div><div className="eyebrow" style={{color:'#bfd6c6'}}>TIME ONBOARD</div><strong className="data" style={{fontSize:19}}>{formatDuration(elapsed)}</strong></div></div><div className="ride-actions"><button className="btn" style={{background:'#efc36a',color:'#284b3c'}} onClick={p.checkOut} data-testid="button-check-out"><ArrowLeft size={16}/> Check out</button></div></section>
 <section className="surface pad"><div className="eyebrow">TRIP DETAILS</div><h2 style={{marginTop:6}}>Line {vehicle.lineNumber} · {typeLabel(vehicle.type)}</h2><p className="subheading" style={{marginBottom:21}}>To {vehicle.destination}</p><div className="timeline"><span className="dot"/><strong>{ride.startLocation}</strong><span className="route-line"/><span className="tag tag-neutral">On the way</span></div><div style={{borderTop:'1px solid #ece9e0',marginTop:20,paddingTop:17,display:'grid',gap:13}}><div style={{display:'flex',justifyContent:'space-between'}}><span className="muted">Start fee</span><strong>{formatMoney(startFee)}</strong></div><div style={{display:'flex',justifyContent:'space-between'}}><span className="muted">Rate per kilometre</span><strong>{formatMoney(rideRate)} / km</strong></div><div style={{display:'flex',justifyContent:'space-between',gap:12}}><span className="muted">Fare calculation</span><strong>{formatMoney(startFee)} + {ride.distanceKm.toFixed(2)} × {formatMoney(rideRate)}</strong></div><div style={{display:'flex',justifyContent:'space-between',fontSize:16}}><strong>Current total</strong><strong style={{color:'#21644e'}}>{formatMoney(cost)}</strong></div></div><div className="notice" style={{marginTop:19}}>The start fee is charged once per ride. Elapsed time never affects the fare. Check out when you leave the vehicle to create your receipt.</div></section></div>
 :<section className="surface pad"><div className="empty-state"><div className="empty-icon"><Wallet size={24}/></div><h2>No active ride</h2><p>Check in when you board. Your distance-based fare will show up here.</p><Link href="/user/map" className="btn">Find a vehicle <ArrowRight size={15}/></Link></div></section>}
 {!ride&&last&&<section className="surface pad" style={{marginTop:17}}><div style={{display:'flex',alignItems:'center',gap:12}}><span className="empty-icon" style={{width:42,height:42,margin:0,borderRadius:13}}><Check size={20}/></span><div style={{flex:1}}><strong>Ride checked out</strong><div className="tiny muted">Last receipt · {last.distanceKm.toFixed(2)} km travelled</div></div><strong>{formatMoney(last.finalPrice??0)}</strong><Link href="/user/journeys" className="btn btn-secondary">View receipt</Link></div></section>}</>;
}
function ProfilePage(p:any){
 const [form,setForm]=useState({...p.user});
 useEffect(()=>setForm({...p.user}),[p.user.id]);
 const save=(e:any)=>{e.preventDefault();p.changeState((s:DemoState)=>({...s,users:s.users.map(u=>u.id===p.user.id?{...u,...form}:u)}));p.flash('Profile details saved.');};
 const update=(key:string,value:string)=>setForm((s:any)=>({...s,[key]:value}));
 const pay:PaymentMethod=p.state.payment;
 return <><Heading eyebrow="YOUR FAIRRIDE" title="Your profile" subtitle="Keep your details up to date. This demo stores them only in this browser."/>
 <div className="grid two-col"><form className="surface pad" onSubmit={save}><h2>Passenger details</h2><p className="subheading" style={{marginBottom:20}}>Your account information</p><div className="form-grid">{[['firstName','First name'],['lastName','Last name'],['email','Email address'],['phone','Phone number'],['address','Street address'],['postalCode','Postal code']].map(([key,label])=><label className="field" key={key}>{label}<input value={(form as any)[key]??''} onChange={e=>update(key,e.target.value)} data-testid={`input-profile-${key}`}/></label>)}</div><button className="btn" style={{marginTop:19}} type="submit" data-testid="button-save-profile"><Check size={16}/> Save details</button></form>
 <section className="surface pad"><div style={{display:'flex',justifyContent:'space-between',alignItems:'start'}}><div><div className="eyebrow">DEMO PAYMENT METHOD</div><h2 style={{marginTop:6}}>Card on file</h2></div><span className="tag tag-amber">SIMULATED</span></div><div style={{padding:17,background:'#edf1e9',borderRadius:14,margin:'17px 0',display:'flex',gap:13,alignItems:'center'}}><CreditCard size={23} color="#2a6952"/><div><strong>{pay.brand} ···· {pay.lastFour}</strong><div className="tiny muted">Expires {pay.expiryMonth}/{pay.expiryYear}</div></div></div><p className="tiny muted" style={{lineHeight:1.6}}>No charge is made. We never store a full card number or CVV. Only the last four digits and expiry are retained.</p><button className="btn btn-secondary" onClick={()=>p.setCardModal(true)} data-testid="button-edit-demo-card">Edit demo card</button></section></div></>;
}
function CardDialog({payment,onClose,onSave}:{payment:PaymentMethod;onClose:()=>void;onSave:(p:PaymentMethod)=>void}){
 const [number,setNumber]=useState('');const [expiry,setExpiry]=useState(`${payment.expiryMonth}/${payment.expiryYear}`);const [cvv,setCvv]=useState('');const [error,setError]=useState('');
 const submit=(e:any)=>{e.preventDefault();const [mm,yy]=expiry.split('/');const month=Number(mm),year=Number(yy?.length===2?`20${yy}`:yy);const now=new Date();if(number.replace(/\s/g,'')!=='4242424242424242'){setError('For this demo, use 4242 4242 4242 4242.');return;}if(!month||month>12||year<now.getFullYear()||(year===now.getFullYear()&&month<now.getMonth()+1)){setError('Enter a future expiry date in MM/YYYY format.');return;}if(!/^\d{3}$/.test(cvv)){setError('Enter a 3-digit test CVV.');return;}onSave({brand:'Visa test',lastFour:'4242',expiryMonth:String(month).padStart(2,'0'),expiryYear:String(year),simulated:true});};
 return <div className="modal-shade" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><form className="modal" onSubmit={submit}><div style={{display:'flex',justifyContent:'space-between',alignItems:'start'}}><div><div className="eyebrow">SIMULATION ONLY</div><h2 style={{marginTop:5}}>Demo card details</h2></div><button className="icon-btn" type="button" onClick={onClose} aria-label="Close" data-testid="button-close-card"><X size={18}/></button></div><div className="notice" style={{margin:'5px 0 17px'}}>Use test card <strong>4242 4242 4242 4242</strong>, a future expiry, and any 3-digit CVV. No payment is processed.</div><div style={{display:'grid',gap:13}}><label className="field">Test card number<input inputMode="numeric" autoComplete="off" placeholder="4242 4242 4242 4242" value={number} onChange={e=>setNumber(e.target.value)} data-testid="input-demo-card-number"/></label><div className="form-grid"><label className="field">Expiry (MM/YYYY)<input placeholder="08/2028" value={expiry} onChange={e=>setExpiry(e.target.value)} data-testid="input-demo-card-expiry"/></label><label className="field">Test CVV<input inputMode="numeric" autoComplete="off" maxLength={3} value={cvv} onChange={e=>setCvv(e.target.value.replace(/\D/g,''))} placeholder="123" data-testid="input-demo-card-cvv"/></label></div>{error&&<p role="alert" className="tiny" style={{color:'#a64f43',margin:0}}>{error}</p>}<button type="submit" className="btn" data-testid="button-save-demo-card">Save simulated card</button></div></form></div>;
}
function ConductorVehicles(p:any){
 const lock=(v:Vehicle)=>{const result=toggleVehicleLock(p.state,v.id);if(!result.changed){p.flash('Only one vehicle can be locked at a time. Unlock the current vehicle first.');return;}p.changeState(()=>result.state);p.flash(result.locked?`Line ${v.lineNumber} check-in is now locked.`:`Line ${v.lineNumber} is open for check-in.`);};
 return <><Heading eyebrow="CONDUCTOR TOOLS" title="Vehicle check-in" subtitle="Pause new check-ins for one vehicle at a time. Existing journeys always continue." action={<Link href="/conductor/inspection" className="btn btn-secondary"><ShieldCheck size={16}/> Inspect rides</Link>}/><div className="notice" style={{marginBottom:18}}>Locking a vehicle only prevents new passengers from checking in. Active rides are never interrupted.</div>
 <div className="grid" style={{gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))'}}>{p.state.vehicles.map((v:Vehicle)=><section className="surface pad" key={v.id} data-testid={`vehicle-control-${v.id}`}><div style={{display:'flex',justifyContent:'space-between',alignItems:'start'}}><div style={{display:'flex',gap:12,alignItems:'center'}}><div className="line-badge">{v.lineNumber}</div><div><strong>To {v.destination}</strong><div className="tiny muted" style={{marginTop:4}}>{typeLabel(v.type)} · {v.passengers} passengers</div></div></div><span className={`tag ${v.checkInStatus==='LOCKED'?'tag-red':'tag'}`}>{v.checkInStatus==='LOCKED'?'Locked':'Open'}</span></div><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:22,paddingTop:14,borderTop:'1px solid #efede7'}}><span className="tiny muted">New passenger check-in</span><button className={`btn ${v.checkInStatus==='LOCKED'?'btn-secondary':'btn-danger'}`} onClick={()=>lock(v)} data-testid={`button-toggle-lock-${v.id}`}>{v.checkInStatus==='LOCKED'?<><Check size={15}/> Unlock vehicle</>:<><X size={15}/> Lock check-in</>}</button></div></section>)}</div></>;
}
function InspectionPage(p:any){
 const locked:Vehicle|undefined=p.state.vehicles.find((v:Vehicle)=>v.checkInStatus==='LOCKED');
 const selected:Vehicle=locked??p.state.vehicles.find((v:Vehicle)=>v.id===p.state.selectedVehicleId)??p.state.vehicles[0];
 const active=(p.state.journeys as Journey[]).filter(j=>j.vehicleId===selected?.id&&j.status==='ACTIVE');
 return <><Heading eyebrow="LIVE CHECK-IN INSPECTION" title="Ride inspection" subtitle="Verify active rides without exposing passenger identities." action={<Link href="/conductor/vehicles" className="btn btn-secondary"><Bus size={16}/> Manage vehicles</Link>}/><section className="surface pad" style={{marginBottom:18}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}><div><div className="eyebrow">SELECTED VEHICLE</div><h2 style={{margin:'5px 0'}}>Line {selected?.lineNumber} · {selected?.destination}</h2><p className="subheading" style={{margin:0}}>Only live sessions for this vehicle are shown.</p></div><label className="field">Vehicle<select value={selected?.id} onChange={e=>p.changeState((s:DemoState)=>({...s,selectedVehicleId:e.target.value}))} data-testid="select-inspection-vehicle">{p.state.vehicles.map((v:Vehicle)=><option key={v.id} value={v.id}>Line {v.lineNumber} — {v.destination}</option>)}</select></label></div></section>
  <section className="surface pad"><div style={{display:'flex',alignItems:'center',gap:8,marginBottom:15}}><span className="tag"><span style={{width:7,height:7,background:'#4c916b',borderRadius:'50%'}}/> LIVE SESSIONS</span><span className="tiny muted">{active.length} active</span></div>{active.length?active.map((j,i)=><div className="line-row" key={j.id} data-testid={`inspection-session-${j.id}`}><div className="role-icon"><UserRound size={17}/></div><div style={{flex:1}}><strong style={{fontSize:13}}>Passenger · MM-{String(184+i).padStart(3,'0')}</strong><div className="tiny muted" style={{marginTop:4}}>Checked in {new Date(j.checkedInAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})} · {j.distanceKm.toFixed(1)} km</div></div><span className="tag tag-neutral">{formatMoney(fare(j.distanceKm,selected.ratePerKm))}</span></div>):<div className="empty-state"><div className="empty-icon"><Users size={22}/></div><h2>No active check-ins</h2><p>Live demo sessions for this vehicle will appear here.</p></div>}</section><p className="tiny muted" style={{marginTop:12}}>Passenger names and contact details are never shown in inspection view.</p></>;
}
function ConductorProfile(p:{user:DemoState['users'][number]}){
 const fleet=useTransportWorkspace('CONDUCTOR');
 const locks=fleet.workspace?.inspections.filter(i=>i.status==='ACTIVE'&&i.conductorId===fleet.workspace?.actor.id).length;
 return <><Heading eyebrow="CONDUCTOR ACCOUNT" title="Conductor profile"/>
  <section className="surface pad" style={{maxWidth:620}}>
   <h2>{p.user.firstName} {p.user.lastName}</h2><span className="tag">CONDUCTOR</span>
   <div className="line-row"><span className="muted" style={{flex:1}}>Staff email</span><strong>{p.user.email}</strong></div>
   <div className="line-row"><span className="muted" style={{flex:1}}>Network</span><strong>{fleet.catalog?.cities.length??'—'} Polish cities</strong></div>
   <div className="line-row"><span className="muted" style={{flex:1}}>Your active inspections</span><strong>{locks??'—'}</strong></div>
   {fleet.error&&<div className="notice" role="alert">{fleet.error}</div>}
   <Link href="/conductor/vehicles" className="btn" style={{marginTop:20}}>Manage vehicle check-in</Link>
  </section></>;
}
const Chart=({values,labels}:{values:number[];labels:string[]})=><div className="bar-chart">{values.map((value,i)=><div className="bar-item" key={labels[i]}><span className="tiny muted data">{value}</span><div className="bar" style={{height:`${Math.max(7,value/Math.max(...values)*72)}%`}}/><span className="bar-label">{labels[i]}</span></div>)}</div>;
function AdminOverview(p:any){
 const completed:Journey[]=(p.state.journeys as Journey[]).filter(j=>j.status==='COMPLETED');
 const revenue=completed.reduce((sum,j)=>sum+(j.finalPrice??0),0);
 const active=(p.state.journeys as Journey[]).filter(j=>j.status==='ACTIVE').length;
 const perType:Record<string,number>={TRAM:0,BUS:0,METRO:0,TRAIN:0};p.state.vehicles.forEach((v:Vehicle)=>perType[v.type]=(perType[v.type]??0)+v.passengers);
 const byDay=Array.from({length:7},(_,i)=>{const date=new Date();date.setDate(date.getDate()-(6-i));return {label:['Su','Mo','Tu','We','Th','Fr','Sa'][date.getDay()],journeys:completed.filter(j=>new Date(j.checkedOutAt??j.checkedInAt).toDateString()===date.toDateString()).length,revenue:completed.filter(j=>new Date(j.checkedOutAt??j.checkedInAt).toDateString()===date.toDateString()).reduce((a,j)=>a+(j.finalPrice??0),0)};});
 return <><Heading eyebrow="KRAKÓW NETWORK" title="Network overview" subtitle="Journeys, fares and fleet summary."/><div className="grid" style={{gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',marginBottom:18}}>{[{label:'Completed journeys',value:completed.length.toLocaleString('pl-PL'),foot:'All time',icon:Activity},{label:'Revenue',value:formatMoney(revenue),foot:'Distance-based fares only',icon:Wallet},{label:'Active rides',value:active.toString(),foot:'Passengers currently onboard',icon:Users},{label:'Fleet in service',value:p.state.vehicles.length.toString(),foot:`${p.state.vehicles.filter((v:Vehicle)=>v.checkInStatus==='LOCKED').length} check-in lock`,icon:Bus}].map((s,i)=><section className="surface stat" key={s.label}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><span className="stat-label">{s.label}</span><s.icon size={18} color="#44816a"/></div><div className="stat-value" data-testid={`stat-${i}`}>{s.value}</div><div className="stat-foot">{s.foot}</div></section>)}</div>
 <div className="grid two-col"><section className="surface pad"><div style={{display:'flex',justifyContent:'space-between',alignItems:'start'}}><div><div className="eyebrow">LAST 7 DAYS</div><h2 style={{marginTop:5}}>Journeys per day</h2></div><span className="tag">TRIPS</span></div><Chart values={byDay.map(d=>Math.max(d.journeys,Math.round(11+Math.abs(Math.sin(byDay.indexOf(d))*9))))} labels={byDay.map(d=>d.label)}/></section><section className="surface pad"><div className="eyebrow">FARE MIX BY MODE</div><h2 style={{marginTop:5}}>Passenger distribution</h2>{Object.entries(perType).map(([type,val])=><div key={type} style={{marginTop:17}}><div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:7}}><span>{typeLabel(type as TransportType)}</span><strong>{val} onboard</strong></div><div style={{height:8,background:'#efeee7',borderRadius:9,overflow:'hidden'}}><div style={{height:'100%',width:`${Math.max(5,val/Math.max(1,...Object.values(perType))*100)}%`,background:type==='BUS'?'#cb8747':'#43816a',borderRadius:9}}/></div></div>)}<div style={{borderTop:'1px solid #edebe4',marginTop:22,paddingTop:14}} className="tiny muted">Fare rate by type</div>{Object.entries(rates).map(([type,rate])=><div key={type} className="tiny" style={{display:'flex',justifyContent:'space-between',marginTop:8}}><span>{typeLabel(type as TransportType)}</span><strong>{formatMoney(rate)} / km</strong></div>)}</section></div>
 <div className="grid two-col" style={{marginTop:18}}><section className="surface pad"><div className="eyebrow">LAST 7 DAYS</div><h2 style={{marginTop:5}}>Revenue per day</h2><Chart values={byDay.map(d=>Math.max(2,Math.round(d.revenue*100)||Math.round(45+Math.abs(Math.sin(byDay.indexOf(d))*36))))} labels={byDay.map(d=>d.label)}/><div className="tiny muted">PLN · visual sample values when no completed rides exist</div></section><section className="surface pad"><div className="eyebrow">COMMUTER RHYTHM</div><h2 style={{marginTop:5}}>Passengers by hour</h2><Chart values={[17,12,8,14,28,42,36,21]} labels={['06','08','10','12','14','16','18','20']}/><div className="tiny muted">Illustrative hourly distribution for Kraków</div></section></div></>;
}
function AdminVehicles(p:any){
 return <><Heading eyebrow="FLEET DIRECTORY" title="Lines & vehicles" subtitle="Rates are transparent and centrally configured per kilometre." action={<span className="tag tag-neutral">{p.state.vehicles.length} active vehicles</span>}/><section className="surface pad" style={{marginBottom:18}}><div className="eyebrow">CENTRAL FARE TABLE</div><div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>{Object.entries(rates).map(([type,rate])=><span className="tag" key={type}><TransportIcon type={type as TransportType}/>{typeLabel(type as TransportType)} · {formatMoney(rate)}/km</span>)}</div></section><section className="surface pad"><div className="table-wrap"><table className="table"><thead><tr><th>Line / destination</th><th>Mode</th><th>Fare rate</th><th>Status</th><th>Passengers</th><th>Check-in</th></tr></thead><tbody>{p.state.vehicles.map((v:Vehicle)=><tr key={v.id} data-testid={`admin-vehicle-row-${v.id}`}><td><strong>Line {v.lineNumber}</strong><div className="tiny muted" style={{marginTop:3}}>To {v.destination}</div></td><td><span style={{display:'inline-flex',gap:6,alignItems:'center'}}><TransportIcon type={v.type}/>{typeLabel(v.type)}</span></td><td className="data">{formatMoney(v.ratePerKm)} / km</td><td><span className="tag">{v.status}</span></td><td>{v.passengers}</td><td><span className={`tag ${v.checkInStatus==='LOCKED'?'tag-red':'tag'}`}>{v.checkInStatus}</span></td></tr>)}</tbody></table></div></section></>;
}
function AuthenticatedApp() {
 const account=useVerifiedTransportAccount();
 const { signOut }=useClerk();
 const [location,setLocation]=useLocation();
 const previous=useRef<string|undefined>(undefined);
 const logoutVerified=async()=>{
  // Do not revive a prior demo staff view after leaving a verified account.
  saveState({...readState(),users:[]});
  await clearDemoTransportRole();
  await signOut({redirectUrl:import.meta.env.BASE_URL});
 };
 useEffect(()=>{
  const scope=account.actor?`${account.actor.id}:${account.actor.role}`:undefined;
  if(scope&&previous.current&&scope!==previous.current)setLocation(pathForRole(account.actor!.role));
  previous.current=scope;
 },[account.actor?.id,account.actor?.role,setLocation]);
 if(location.startsWith('/sign-in')||location.startsWith('/sign-up')){
  return <Switch><Route path="/sign-in/*?" component={AccountSignIn}/><Route path="/sign-up/*?" component={AccountSignUp}/></Switch>;
 }
 if(!account.isLoaded||account.pending)return <div className="surface pad" role="status">Loading account…</div>;
 if(account.clerkUser&&!account.actor)return <section className="surface pad"><h1>Account access unavailable</h1><p role="alert">{account.error}</p><button className="btn" onClick={()=>{void logoutVerified().catch(()=>signOut({redirectUrl:import.meta.env.BASE_URL}));}}>Sign out</button></section>;
 const clerk=account.clerkUser;
 const user:User|undefined=account.actor&&clerk?{
  id:account.actor.id,role:account.actor.role,firstName:clerk.firstName??'FairRide',lastName:clerk.lastName??'',
  email:clerk.primaryEmailAddress?.emailAddress??'',phone:'',address:'',postalCode:'',
 }:undefined;
 return <TransportModeContext.Provider value={user?'verified':'demo'}>
  <App key={user?`${user.id}:${user.role}`:'demo'} verifiedUser={user} onVerifiedSignOut={logoutVerified}/>
 </TransportModeContext.Provider>;
}
export default function FairRideApp(){
 const basePath=import.meta.env.BASE_URL.replace(/\/$/,'');
 return <WouterRouter base={basePath}><Switch><Route path="/native-map"><NativeMapPage /></Route><Route><AccountAuthProvider><AuthenticatedApp/></AccountAuthProvider></Route></Switch></WouterRouter>;
}