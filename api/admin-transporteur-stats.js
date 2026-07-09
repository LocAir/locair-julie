const { getSupabase }    = require('./_lib/supabase');
const { getCity }         = require('./_lib/city');
const { checkAdminToken } = require('./_lib/auth');

// ── Performance score (100 pts) ────────────────────────────────────────────
// 5 critères pondérés : acceptation (25), complétion (30), notif client (20),
// preuves terrain (15), sans incident (10).
function computePerf(missions) {
  const total = missions.length;
  if (!total) return { score: null };

  const refused  = missions.filter(m => m.statut === 'refusee').length;
  const active   = total - refused;
  const fait     = missions.filter(m => m.statut === 'fait').length;
  const mFait    = missions.filter(m => m.statut === 'fait');

  const accept   = total > 0 ? 1 - refused / total : 1;
  const complete = active > 0 ? fait / active : 1;
  const notif    = mFait.length > 0
    ? mFait.filter(m => m.client_notifie_at).length / mFait.length : 1;
  const proofOk  = mFait.filter(m =>
    m.type === 'livraison'
      ? (m.photo_depart_path && m.video_installation_path)
      : m.photo_retour_path
  ).length;
  const proof   = mFait.length > 0 ? proofOk / mFait.length : 1;
  const noInc   = total > 0
    ? 1 - missions.filter(m => ['retard','autre'].includes(m.probleme_type)).length / total
    : 1;

  return {
    score:        Math.min(100, Math.max(0, Math.round(accept*25 + complete*30 + notif*20 + proof*15 + noInc*10))),
    acceptance:   Math.round(accept   * 100),
    completion:   Math.round(complete * 100),
    notification: Math.round(notif    * 100),
    proof:        Math.round(proof    * 100),
    no_incident:  Math.round(noInc    * 100),
  };
}

// ── livraisons/heure (temps actif = somme des durées mission) ──────────────
function computeLph(missions) {
  const done = missions.filter(m => m.statut === 'fait' && m.accepted_at && m.fait_at);
  if (!done.length) return '—';
  const hrs = done.reduce((s, m) =>
    s + (new Date(m.fait_at) - new Date(m.accepted_at)) / 3600000, 0);
  return hrs > 0 ? (done.length / hrs).toFixed(1) : '—';
}

// ── Groupage pour le graphique ─────────────────────────────────────────────
const FR_M = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
const FR_D = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];

function buildChart(missions, period) {
  const now = new Date();

  if (period === 'hour') {
    const b = Array.from({length:24}, (_,h) => ({ label:`${String(h).padStart(2,'0')}h`, total:0 }));
    missions.forEach(m => { if (m.fait_at) b[new Date(m.fait_at).getHours()].total++; });
    return b;
  }
  if (period === 'day') {
    const map = {};
    for (let i=6;i>=0;i--){ const d=new Date(now);d.setDate(d.getDate()-i);d.setHours(0,0,0,0);const k=d.toISOString().slice(0,10);map[k]={label:`${FR_D[d.getDay()]} ${d.getDate()}`,total:0}; }
    missions.forEach(m => { if (map[m.date_prevue]) map[m.date_prevue].total++; });
    return Object.values(map);
  }
  if (period === 'week') {
    const map = {};
    for (let i=3;i>=0;i--){
      const d=new Date(now);d.setDate(d.getDate()-i*7);
      const dy=d.getDay()||7;d.setDate(d.getDate()-dy+1);d.setHours(0,0,0,0);
      const k=d.toISOString().slice(0,10);
      const wn=Math.ceil(((d-new Date(d.getFullYear(),0,1))/86400000+new Date(d.getFullYear(),0,1).getDay()+1)/7);
      map[k]={label:`S.${wn}`,total:0};
    }
    missions.forEach(m => {
      const md=new Date(m.date_prevue);const dy=md.getDay()||7;
      md.setDate(md.getDate()-dy+1);md.setHours(0,0,0,0);
      const k=md.toISOString().slice(0,10);if(map[k])map[k].total++;
    });
    return Object.values(map);
  }
  if (period === 'month') {
    const map = {};
    for (let i=11;i>=0;i--){ const d=new Date(now);d.setDate(1);d.setMonth(d.getMonth()-i);const k=d.toISOString().slice(0,7);map[k]={label:FR_M[d.getMonth()],total:0}; }
    missions.forEach(m => { const k=m.date_prevue.slice(0,7);if(map[k])map[k].total++; });
    return Object.values(map);
  }
  // year
  const y=now.getFullYear(),map={};
  for (let i=4;i>=0;i--){ const yr=y-i;map[yr]={label:String(yr),total:0}; }
  missions.forEach(m => { const yr=parseInt(m.date_prevue.slice(0,4));if(map[yr])map[yr].total++; });
  return Object.values(map);
}

// ── Plages de dates pour la période + période précédente ──────────────────
function periodRange(period) {
  const now = new Date();
  let start, prevStart;
  if (period === 'hour') {
    start=new Date(now);start.setHours(0,0,0,0);
    prevStart=new Date(start);prevStart.setDate(prevStart.getDate()-1);
  } else if (period === 'day') {
    start=new Date(now);start.setDate(now.getDate()-6);start.setHours(0,0,0,0);
    prevStart=new Date(start);prevStart.setDate(prevStart.getDate()-7);
  } else if (period === 'week') {
    start=new Date(now);start.setDate(now.getDate()-27);start.setHours(0,0,0,0);
    prevStart=new Date(start);prevStart.setDate(prevStart.getDate()-28);
  } else if (period === 'year') {
    start=new Date(now);start.setFullYear(now.getFullYear()-4);start.setMonth(0);start.setDate(1);start.setHours(0,0,0,0);
    prevStart=new Date(start);prevStart.setFullYear(prevStart.getFullYear()-5);
  } else { // month (default)
    start=new Date(now);start.setMonth(now.getMonth()-11);start.setDate(1);start.setHours(0,0,0,0);
    prevStart=new Date(start);prevStart.setMonth(prevStart.getMonth()-12);
  }
  return { start: start.toISOString().slice(0,10), prevStart: prevStart.toISOString().slice(0,10) };
}

// ── Handler ────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    const city = await getCity(supabase);

    // ── list ───────────────────────────────────────────────────────────────
    if (action === 'list') {
      const { data: tList, error: tErr } = await supabase.from('transporteurs')
        .select('id, nom, actif, en_pause').eq('city_id', city.id).order('nom');
      if (tErr) throw tErr;

      const d30 = new Date(); d30.setDate(d30.getDate()-30);
      const tIds = (tList||[]).map(t => t.id);
      const { data: livs30 } = tIds.length
        ? await supabase.from('livraisons')
            .select('transporteur_id, statut, type, client_notifie_at, fait_at, accepted_at, photo_depart_path, video_installation_path, photo_retour_path, probleme_type')
            .in('transporteur_id', tIds)
            .gte('date_prevue', d30.toISOString().slice(0,10))
        : { data: [] };

      const byT = {};
      (livs30||[]).forEach(m => { if(!byT[m.transporteur_id])byT[m.transporteur_id]=[]; byT[m.transporteur_id].push(m); });

      const transporteurs = (tList||[]).map(t => ({
        ...t,
        en_pause:    t.en_pause || false,
        missions_30j: (byT[t.id]||[]).length,
        perf_score:  computePerf(byT[t.id]||[]).score,
      }));

      return res.status(200).json({ transporteurs });
    }

    // ── stats ──────────────────────────────────────────────────────────────
    if (action === 'stats') {
      const tid = parseInt(body.transporteur_id);
      if (!tid) return res.status(400).json({ error: 'transporteur_id manquant' });

      const { data: tr } = await supabase.from('transporteurs').select('id').eq('id', tid).eq('city_id', city.id).maybeSingle();
      if (!tr) return res.status(404).json({ error: 'Transporteur introuvable' });

      const period = body.period || 'month';
      const { start, prevStart } = periodRange(period);
      const SEL = 'id, type, statut, date_prevue, fait_at, accepted_at, client_notifie_at, photo_depart_path, video_installation_path, photo_retour_path, probleme_type';

      const [{ data: cur }, { data: prev }] = await Promise.all([
        supabase.from('livraisons').select(SEL).eq('transporteur_id', tid).gte('date_prevue', start).order('date_prevue'),
        supabase.from('livraisons').select('id').eq('transporteur_id', tid).gte('date_prevue', prevStart).lt('date_prevue', start),
      ]);

      const missions  = cur  || [];
      const prevCount = (prev || []).length;
      const growth    = prevCount > 0
        ? Math.round((missions.length - prevCount) / prevCount * 100)
        : (missions.length > 0 ? 100 : null);

      return res.status(200).json({
        total:        missions.length,
        fait:         missions.filter(m => m.statut === 'fait').length,
        livraisons:   missions.filter(m => m.type  === 'livraison').length,
        recuperations: missions.filter(m => m.type === 'recuperation').length,
        lph:          computeLph(missions),
        growth,
        chart:        buildChart(missions, period),
        perf:         computePerf(missions),
      });
    }

    // ── pause / resume / stop / activate ──────────────────────────────────
    const tid = parseInt(body.transporteur_id);
    if (!tid) return res.status(400).json({ error: 'transporteur_id manquant' });

    const { data: trCheck } = await supabase.from('transporteurs').select('id, en_pause').eq('id', tid).eq('city_id', city.id).maybeSingle();
    if (!trCheck) return res.status(404).json({ error: 'Transporteur introuvable' });

    const patches = {
      pause:    { en_pause: true  },
      resume:   { en_pause: false, actif: true  },
      stop:     { actif: false    },
      activate: { actif: true, en_pause: false },
    };
    if (!patches[action]) return res.status(400).json({ error: 'Action inconnue' });

    const { error: upErr } = await supabase.from('transporteurs').update(patches[action]).eq('id', tid);
    if (upErr) throw upErr;
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[Admin transporteur stats]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
