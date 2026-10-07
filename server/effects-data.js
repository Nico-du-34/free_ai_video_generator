'use strict';
// Catalogue d'effets : mouvements chorégraphiés (beats), caméra, filtres, transitions et styles visuels.
// slot : motion | camera | filter | trans | style   (un effet par slot et par scène)
const E = [];
const motion = (cat, rows, style) => rows.forEach(([id, name, desc, beats]) => E.push({ slot: 'motion', cat, id, name, desc, beats: beats.split('|').map((x) => x.trim()), style: style || '' }));
const style = (cat, rows) => rows.forEach(([id, name, desc, text]) => E.push({ slot: 'style', cat, id, name, desc, style: text }));
const camera = (rows) => rows.forEach(([id, name, desc, cam]) => E.push({ slot: 'camera', cat: 'Caméra', id, name, desc, cam }));
const filter = (rows) => rows.forEach(([id, name, desc, fx]) => E.push({ slot: 'filter', cat: 'Filtres & rendu', id, name, desc, fx }));
const trans = (rows) => rows.forEach(([id, name, desc, t, d]) => E.push({ slot: 'trans', cat: 'Cuts & transitions', id, name, desc, trans: t, transDur: d }));

/* ---------- MOUVEMENTS : chaque effet décrit une séquence d'instants clés ---------- */
motion('Combat & arts martiaux', [
  ['kungfu', 'Kung Fu cinématique', 'Enchaînement fluide : garde, coup de pied sauté, frappe, retombée', 'martial artist in a calm fighting stance, weight low|spinning high flying kick, body fully extended in mid air|powerful palm strike landing, shockwave of dust|landing in a crouch, sleeve and hair still flowing'],
  ['karate', 'Karaté impact', 'Coup puissant avec onde de choc', 'karate fighter in zenkutsu stance, fists at the hip|explosive straight punch, arm fully extended, speed lines|impact moment with a visible shockwave ring|returns to the guard stance, calm and focused'],
  ['boxing', 'Boxe / MMA', 'Esquive, crochet, sueur au ralenti', 'boxer in guard, gloves up, light sweat|ducking under a swinging punch, torso low|powerful hook thrown, sweat droplets flying|opponent staggers back, boxer steps forward in guard'],
  ['samurai', 'Samouraï au katana', 'Duel au sabre, pétales qui volent', 'samurai hand on the katana hilt, cherry petals drifting|blade drawn in one lightning slash, motion arc of steel|petals scatter around the finished cut|slow resheathing of the sword, perfectly still'],
  ['ninja', 'Ninja furtif', 'Déplacement silencieux, fumée, shurikens', 'ninja crouched on a rooftop at night|leaping through the air, cloak trailing|throwing shuriken that glint in the moonlight|vanishing in a puff of smoke'],
  ['fantasyfight', 'Arts martiaux énergétiques', 'Aura, vol, projectiles d énergie', 'fighter gathering glowing energy in both hands|lifting off the ground, aura blazing|firing a beam of energy forward|beam impact light fills the frame, fighter floating'],
  ['chase', 'Poursuite urbaine', 'Course-poursuite, sauts, cascades', 'runner sprinting through a narrow city street|vaulting over a market stall|leaping across a gap between rooftops|landing and rolling, continuing to run'],
  ['matrix', 'Combat ralenti façon Matrix', 'Bullet time et esquives en arrière', 'hero standing, coat rippling in the wind|leaning back nearly horizontal, avoiding projectiles in slow motion|spinning kick frozen at the peak, debris suspended|hero landing, projectiles falling to the ground'],
  ['wuxia', 'Wuxia dans les bambous', 'Combat aérien poétique', 'swordsman standing at the top of a bamboo stalk|gliding horizontally between bamboo, robes flowing|crossing swords mid air, leaves exploding around|elegant landing on one foot, leaves falling slowly'],
  ['streetfight', 'Street fight brut', 'Combat de rue, caméra épaule', 'two fighters circling in an alley, tense|a hard punch connecting, head snapping sideways|grappling and shoving against a wall|one fighter walking away, the other on one knee'],
]);
motion('Danse', [
  ['hiphop', 'Hip-hop / Breakdance', 'Freeze, windmill, battle de rue', 'b-boy starting a top rock in a graffiti street|going down into a floor spin, legs spinning|windmill rotation with legs wide, motion blur|freezing in a handstand freeze pose, crowd cheering'],
  ['ballet', 'Ballet classique', 'Pirouettes et grands jetés', 'ballerina in fifth position, spotlight|rising en pointe into a pirouette, tutu fanning|grand jeté leap, legs in a perfect split|graceful landing, arms in a soft arabesque'],
  ['contemporary', 'Danse contemporaine', 'Mouvements fluides et émotion', 'dancer curled low on the floor, flowing fabric|slowly unfolding upward, arms sweeping|a full body arch, fabric whipping through the air|dissolving into stillness with arms open'],
  ['kpop', 'Chorégraphie K-pop', 'Groupe synchronisé, néons', 'k-pop group in formation on a neon stage|synchronized sharp arm moves, all in unison|formation switching, dancers crossing paths|final pose, all together, confetti falling'],
  ['tango', 'Tango / Salsa', 'Couple passionné', 'couple in a close tango embrace|sharp leg flick and fast turn|dramatic dip with the partner arched back|rising back, eyes locked, dim warm light'],
  ['tap', 'Claquettes', 'Jeu de jambes rythmé', 'tap dancer feet in polished shoes, stage floor|rapid shuffle steps, sparks of reflection|spin ending with a stomp|tipping the hat, final pose'],
  ['firedance', 'Danse du feu', 'Feu hypnotique', 'dancer holding flaming poi at dusk|swinging fire in large circles, trails of light|fire ring spinning around the body|flames fading into embers'],
  ['vogue', 'Vogue / Ballroom', 'Poses et défilé', 'vogue dancer striking a hand pose, fashion lighting|dramatic duckwalk toward the camera|a dip pose with a flourish of the arms|final catwalk strut, judges applauding'],
  ['bollywood', 'Danse Bollywood', 'Couleurs et énergie de groupe', 'dancers in vivid saris and sherwanis in a courtyard|a spin with skirts flaring|group jumping in unison, petals thrown in the air|joyful final pose in a colourful burst'],
  ['slowdance', 'Danse au ralenti avec particules', 'Poussière dorée en suspension', 'dancer poised in a beam of light, golden dust|a slow turn, dust swirling around|a leap frozen mid air, particles suspended|gentle landing, dust settling'],
]);
motion('Pouvoirs & effets spéciaux', [
  ['explosion', 'Explosion cinématique', 'Boule de feu, onde de choc, débris', 'a calm scene just before the blast|fireball erupting, bright flash|shockwave sweeping outward, debris flying toward camera|smoke and embers settling'],
  ['speed', 'Super vitesse', 'Effet Flash, traînées lumineuses', 'hero standing, electricity crackling around the legs|bursting forward leaving streaks of light|blurred ultra fast run, trail of lightning|skidding to a stop, dust and sparks'],
  ['telekinesis', 'Télékinésie', 'Objets qui flottent et volent', 'person extending a hand, objects trembling|objects lifting off the ground|objects orbiting rapidly around the person|everything snapping back to the ground'],
  ['energyball', 'Boule d énergie', 'Projection entre les mains', 'hands cupped, a spark of light forming|a glowing sphere growing between the hands|thrusting the sphere forward with a flash|energy trail and lingering glow'],
  ['lightning', 'Foudre', 'Pouvoir électrique, yeux brillants', 'eyes starting to glow blue, static in the hair|arcs of electricity crawling over the arms|a bolt of lightning blasting from the palm|afterglow with small sparks'],
  ['ice', 'Glace & givre', 'Cristaux et souffle froid', 'hand touching a surface, frost starting|ice crystals spreading rapidly|everything covered in sharp ice, cold mist|final frozen scene glittering'],
  ['teleport', 'Téléportation', 'Disparition et apparition', 'character standing, particles beginning to shimmer|body dissolving into glowing particles|particles streaming to another place|character reappearing, smoke dissipating'],
  ['levitate', 'Lévitation', 'Le sujet flotte', 'person standing with eyes closed|feet lifting off the ground|floating high, clothes and hair drifting upward|slowly descending back down'],
  ['transform', 'Transformation', 'Métamorphose progressive', 'a person in a normal state|body shimmering, features beginning to change|mid transformation, light bursting from within|fully transformed, powerful pose'],
  ['summon', 'Invocation', 'Une créature apparaît', 'magic circle drawn on the ground glowing|runes igniting, wind rising|a creature rising out of the circle in light|the creature fully formed, towering'],
  ['shield', 'Bouclier magique', 'Dôme d énergie protecteur', 'hero raising a hand as danger approaches|a translucent dome of energy expanding|projectiles hitting the shield and rippling it|shield dissolving into sparks'],
  ['portal', 'Portail dimensionnel', 'Ouverture vers un autre monde', 'a spark in the air tearing open|a ring of light widening into a portal|another world visible through the portal, wind pulling|character stepping through, portal closing'],
  ['meteors', 'Pluie de météores', 'Le ciel s embrase', 'dark sky, one streak of light|dozens of meteors burning across the sky|meteors impacting the horizon, flashes|glowing craters and dust'],
  ['timecontrol', 'Contrôle du temps', 'Gel et retour en arrière', 'busy scene moving normally, hero raising a hand|everything freezing, droplets suspended|clock hands spinning backward, objects reversing|time resuming, hero lowering the hand'],
  ['regen', 'Régénération', 'Une blessure se referme', 'a visible wound, pain on the face|golden light knitting the wound|skin repairing, light fading|healthy and standing tall'],
]);
motion('Catastrophes & nature', [
  ['tornado', 'Tornade', 'Vent violent et débris', 'dark sky with a funnel forming|funnel touching the ground, debris lifting|full tornado tearing through, objects flying|the tornado dissipating, calm light'],
  ['tsunami', 'Tsunami', 'Vague géante', 'sea receding unnaturally|a giant wave rising on the horizon|massive wave towering over the coast|water flooding streets, foam'],
  ['earthquake', 'Séisme', 'Le sol tremble', 'objects trembling on a table|cracks racing across the ground|buildings shaking, dust falling|stillness after, dust floating'],
  ['volcano', 'Éruption volcanique', 'Lave et cendres', 'smoking volcano summit at dusk|explosive eruption, lava fountain|pyroclastic ash cloud rolling down|glowing lava rivers in darkness'],
  ['sandstorm', 'Tempête de sable', 'Mur de poussière', 'clear desert horizon|a wall of dust approaching|engulfing sandstorm, near zero visibility|dust settling over dunes'],
  ['blizzard', 'Blizzard', 'Neige violente', 'light snow falling on a mountain|wind rising, snow thickening|whiteout blizzard, figure bent against the wind|storm calming, snow drifts'],
  ['thunderstorm', 'Orage électrique', 'Éclairs multiples', 'heavy clouds rolling in|first lightning bolt, rain starting|multiple lightning strikes, torrential rain|storm rumbling away, wet reflections'],
  ['aurora', 'Aurore boréale', 'Ciel vert et rose mouvant', 'starry polar night|green ribbons appearing|aurora rippling and pulsing, pink edges|fading slowly into stars'],
  ['eclipse', 'Éclipse', 'Soleil noir', 'bright day with the sun high|the moon crossing the sun, light dimming|total eclipse, glowing corona, darkness|light returning with a diamond ring flash'],
  ['shootingstars', 'Étoiles filantes', 'Ciel nocturne magique', 'night sky above a calm lake|the first shooting star|many shooting stars, reflections on the water|soft glow of the milky way'],
]);
motion('Sport', [
  ['football', 'Football', 'But et célébration', 'striker running with the ball on a floodlit pitch|powerful shot, leg swinging through the ball|ball hitting the net, goalkeeper diving|player celebrating, arms wide, crowd roaring'],
  ['basket', 'Basketball', 'Dunk et suspension', 'player dribbling at full speed|taking off toward the hoop|dunking, ball over the rim, hang time|landing, crowd erupting'],
  ['tennis', 'Tennis', 'Échange rapide et smash', 'player waiting at the baseline|powerful forehand swing, ball compressed|jumping smash, racket high|ball bouncing, player roaring'],
  ['sprint', 'Course à pied', 'Sprint et dépassement', 'runners on the starting blocks|explosive start, muscles tense|overtaking on the final stretch, sweat flying|crossing the line, arms raised'],
  ['swim', 'Natation', 'Plongeon et crawl', 'swimmer on the starting block|diving, body arched over the water|powerful freestyle strokes, splashes|touching the wall, water streaming'],
  ['skate', 'Skateboard', 'Figure et atterrissage', 'skater rolling toward a ramp|ollie high above the rail|kickflip with the board spinning|landing and rolling away'],
  ['surf', 'Surf', 'Tube et écume', 'surfer paddling and catching a wave|standing up, carving the face|riding inside a barrel, spray|kicking out of the wave'],
  ['climb', 'Escalade', 'Ascension jusqu au sommet', 'climber gripping a rock face, chalk dust|dynamic reach to a distant hold|hanging by fingers, muscles taut|reaching the summit, arms up at sunrise'],
  ['gym', 'Gymnastique', 'Sauts et rotations', 'gymnast saluting before the routine|vaulting into a series of flips|a perfect aerial twist|stuck landing, arms raised'],
  ['cycling', 'Cyclisme', 'Descente rapide', 'cyclist on a mountain ridge at dawn|starting a fast descent|leaning hard into a switchback|speeding along a coastal road'],
  ['ski', 'Ski / Snowboard', 'Poudreuse et saut', 'snowboarder at the edge of a slope|carving through powder, snow spray|launching off a jump, grabbing the board|landing in powder, glide'],
  ['f1', 'Formule 1', 'Vitesse et dépassement', 'F1 car on the grid, heat haze|blasting off, tires smoking|overtaking in a corner, sparks|taking the chequered flag'],
  ['parkour', 'Parkour', 'Sauts urbains', 'runner at the edge of a rooftop|big leap across a gap|vault and roll on landing|sprinting on, fluid'],
  ['yoga', 'Yoga', 'Postures et respiration', 'person in mountain pose at sunrise|flowing into warrior pose|balancing in tree pose|calm lotus pose, warm light'],
  ['archery', 'Tir à l arc', 'Concentration et tir', 'archer drawing the bow, focused eye|holding breath, string taut|release, arrow flying with a streak|arrow hitting the bullseye'],
]);
motion('Véhicules & machines', [
  ['sportscar', 'Voiture de sport', 'Drift et accélération', 'sports car idling on a wet road at night|accelerating hard, headlights streaking|drifting around a corner, smoke from tires|speeding away, tail lights blurring'],
  ['bike', 'Moto', 'Roue arrière et virage', 'motorcycle revving at a traffic light|wheelie launching forward|leaning deep into a curve|speeding down a highway'],
  ['plane', 'Avion', 'Décollage et nuages', 'airplane on the runway at dawn|accelerating, wheels leaving the ground|climbing through clouds|cruising above a golden cloud sea'],
  ['helicopter', 'Hélicoptère', 'Survol et rotation', 'helicopter on a helipad, rotors starting|lifting off, dust blowing|banking over a canyon|hovering above a city skyline'],
  ['boat', 'Bateau', 'Vagues et embruns', 'speedboat leaving a harbor|accelerating, bow lifting, spray|sharp turn throwing a wave|cruising into the sunset'],
  ['train', 'Train', 'Passage et paysage', 'train approaching in the distance, heat haze|rushing past the camera, wind|carriages blurring in speed|disappearing into the horizon'],
  ['mecha', 'Robot géant / Mecha', 'Marche, transformation, combat', 'giant mech standing in a hangar|first heavy step, ground shaking|transforming, panels unfolding|firing a weapon, muzzle flash'],
  ['spaceship', 'Vaisseau spatial', 'Décollage et hyperespace', 'spaceship on a launch pad, steam|blasting off with a column of fire|jumping to hyperspace, stretching stars|arriving above a glowing planet'],
  ['submarine', 'Sous-marin', 'Plongée dans l abysse', 'submarine at the surface|diving beneath the waves|gliding past glowing creatures|searchlight on a deep sea wreck'],
  ['balloon', 'Montgolfière', 'Envol au lever du soleil', 'hot air balloon being inflated at dawn|lifting off gently|floating over misty valleys|soaring beside golden clouds'],
]);
motion('Émotions & expressions', [
  ['joy', 'Joie', 'Sourire qui s élargit', 'neutral calm face|a smile beginning|laughing out loud, eyes crinkled|radiant happy expression'],
  ['sadness', 'Tristesse', 'Larme et regard baissé', 'a thoughtful face|eyes glistening|a tear rolling down|head lowered, sorrowful'],
  ['anger', 'Colère', 'Regard intense', 'tense jaw, narrowed eyes|brow furrowing, nostrils flaring|shouting in rage, face red|fists clenched, fierce glare'],
  ['fear', 'Peur', 'Recul et tremblement', 'wary look, eyes darting|eyes widening in dread|stepping back, trembling|frozen in terror'],
  ['surprise', 'Surprise', 'Sursaut', 'relaxed expression|sudden jolt, eyebrows rising|mouth open in shock|hands over the mouth'],
  ['love', 'Amour', 'Regard tendre', 'a quiet glance|a soft warm smile|eyes full of tenderness|a gentle embrace in warm light'],
  ['nostalgia', 'Nostalgie', 'Souvenir flou', 'person looking at an old photograph|eyes softening|a faint smile, warm sepia tone|looking into the distance'],
  ['determination', 'Détermination', 'Regard fixe', 'a deep breath, eyes closed|eyes opening with focus|jaw set, rising resolve|walking forward with purpose'],
  ['madness', 'Folie', 'Rire nerveux', 'an odd calm smile|eye twitching, giggling begins|wild unhinged laughter|manic stare into camera'],
  ['serenity', 'Sérénité', 'Respiration lente', 'closed eyes, still face|slow deep breath|a gentle smile|peaceful glow of light'],
]);
motion('Fantastique & mythologie', [
  ['dragon', 'Dragon', 'Vol et souffle de feu', 'a dragon perched on a cliff at dusk|spreading enormous wings|taking flight with a roar|breathing a torrent of fire'],
  ['unicorn', 'Licorne', 'Forêt magique', 'unicorn standing in an enchanted glade|lifting its head, horn glowing|galloping with sparkles trailing|rearing up in a rainbow light'],
  ['mermaid', 'Sirène', 'Océan et chant', 'mermaid resting on a rock at moonrise|diving gracefully, tail flashing|swimming among glowing jellyfish|surfacing singing in moonlight'],
  ['phoenix', 'Phénix', 'Renaissance dans les flammes', 'a burning bird perched on ashes|the body bursting into flames|rising from the ashes with wings spread|soaring in a blaze of gold'],
  ['werewolf', 'Loup-garou', 'Transformation sous la lune', 'a man staring at the full moon|body convulsing, fur sprouting|claws extending, face lengthening|howling beast on a hilltop'],
  ['vampire', 'Vampire', 'Nuit et cape', 'a pale figure in a gothic hall|eyes glowing red|cape flaring, fangs revealed|dissolving into a swarm of bats'],
  ['ghost', 'Fantôme', 'Apparition', 'an empty candlelit room|cold mist forming|a translucent figure appearing|drifting through a wall'],
  ['angeldemon', 'Ange / Démon', 'Ailes et halo', 'a figure shrouded in shadow|wings unfolding, one white one black|halo and flames igniting|a dramatic standoff, light versus fire'],
  ['thor', 'Dieu nordique', 'Tonnerre et marteau', 'a god on a mountaintop, storm gathering|hammer raised, lightning gathering|slamming down, thunderclap|aftermath of shining rain'],
  ['kraken', 'Créature des abysses', 'Tentacules dans la nuit', 'dark ocean surface at night|a huge shadow beneath|tentacles bursting out of the sea|dragging a ship under'],
]);
motion('Gaming & virtuel', [
  ['rpghero', 'Héros RPG', 'Équipement et attaque', 'RPG hero in armor on a hilltop|drawing a glowing sword|a slashing attack with a magic arc|victory pose with loot sparkles'],
  ['gamecinematic', 'Cinématique de jeu', 'Intro épique AAA', 'wide shot of a ruined city, ash falling|the hero emerging from the smoke|a sprint through the ruins|a hero close up, eyes full of resolve'],
  ['vtuber', 'Avatar VTuber', 'Salut et réaction', 'anime avatar waving at the camera|tilting the head with a cheerful smile|a surprised reaction with sparkles|blowing a kiss, hearts floating'],
  ['voxel', 'Monde voxel', 'Construction bloc par bloc', 'an empty flat voxel field|blocks rising into a tower|a village of cubes assembling|a sunset over the finished world'],
]);

/* ---------- CAMÉRA (appliquée par ffmpeg sur la séquence, déterministe) ---------- */
camera([
  ['push', 'Push-in dramatique', 'Zoom lent vers le sujet', 'push'],
  ['pull', 'Pull-out révélation', 'Dézoom qui révèle le contexte', 'pull'],
  ['panr', 'Travelling latéral →', 'Déplacement horizontal fluide', 'panr'],
  ['panl', 'Travelling latéral ←', 'Déplacement horizontal inverse', 'panl'],
  ['tiltup', 'Tilt up', 'Révélation vers le haut', 'tiltup'],
  ['tiltdown', 'Tilt down', 'Descente verticale', 'tiltdown'],
  ['crane', 'Plan grue', 'Montée verticale avec dézoom', 'crane'],
  ['drone', 'Drone aérien', 'Survol qui prend de la hauteur', 'drone'],
  ['orbit', 'Orbite', 'Balayage autour du sujet', 'orbit'],
  ['whip', 'Whip pan', 'Balayage rapide', 'whip'],
  ['handheld', 'Caméra épaule', 'Tremblement organique', 'handheld'],
  ['pov', 'Caméra subjective', 'Avancée instable, regard du sujet', 'pov'],
  ['dolly', 'Dolly zoom', 'Zoom rapide appuyé', 'dolly'],
  ['steadi', 'Steadicam fluide', 'Glisse lente et stable', 'steadi'],
  ['parallax', 'Parallaxe', 'Mouvement ample sur une image fixe', 'parallax'],
]);

/* ---------- FILTRES & RENDU ---------- */
filter([
  ['vhs', 'VHS / magnétoscope', 'Bruit, décalage couleur, lignes', 'vhs'],
  ['glitch', 'Glitch numérique', 'Décalages RVB et bruit', 'glitch'],
  ['sepia', 'Sépia ancien', 'Teinte brune vintage', 'sepia'],
  ['noir', 'Noir & blanc contrasté', 'Film noir, vignettage', 'noir'],
  ['neon', 'Néons saturés', 'Cyberpunk rose et cyan', 'neon'],
  ['bleach', 'Délavé cinéma', 'Désaturé et contrasté', 'bleach'],
  ['grain', 'Grain de pellicule', 'Grain et vignettage', 'grain'],
  ['pixel', 'Pixel art', 'Pixels 8 bits', 'pixel'],
  ['thermal', 'Caméra thermique', 'Fausses couleurs infrarouge', 'thermal'],
  ['holo', 'Hologramme', 'Cyan transparent et lignes', 'holo'],
  ['dream', 'Rêve flou', 'Lueur douce', 'dream'],
  ['xray', 'Rayons X', 'Négatif contrasté', 'xray'],
  ['tealorange', 'Teal & orange', 'Étalonnage blockbuster', 'tealorange'],
  ['golden', 'Heure dorée', 'Tons chauds', 'golden'],
  ['night', 'Nuit froide', 'Tons bleus sombres', 'night'],
  ['posterize', 'Cartoon contrasté', 'Aplats et contours', 'posterize'],
]);

/* ---------- CUTS & TRANSITIONS (entre les scènes) ---------- */
trans([
  ['cut', 'Jump cut', 'Coupe sèche', 'cut', 0.04],
  ['match', 'Match cut / fondu', 'Fondu enchaîné doux', 'dissolve', 0.8],
  ['smash', 'Smash cut', 'Rupture brutale via le noir', 'fadeblack', 0.18],
  ['flash', 'Flash blanc', 'Éclair entre deux plans', 'fadewhite', 0.22],
  ['glitchcut', 'Transition glitch', 'Pixelisation numérique', 'pixelize', 0.4],
  ['whipcut', 'Transition whip pan', 'Glissement rapide', 'slideleft', 0.25],
  ['zoomcut', 'Zoom cut', 'Zoom qui devient le plan suivant', 'zoomin', 0.5],
  ['circle', 'Ouverture en cercle', 'Iris', 'circleopen', 0.6],
  ['radial', 'Balayage radial', 'Effet horloge', 'radial', 0.6],
  ['wipe', 'Volet', 'Balayage latéral', 'wipeleft', 0.5],
  ['blur', 'Flou directionnel', 'Transition floue', 'hblur', 0.5],
  ['slices', 'Tranches', 'Découpe en bandes', 'hlslice', 0.6],
  ['fadeblack', 'Fondu au noir', 'Coupe dans l obscurité', 'fadeblack', 0.9],
  ['squeeze', 'Écrasement', 'Compression horizontale', 'squeezeh', 0.5],
  ['smooth', 'Glisse douce', 'Transition fluide', 'smoothleft', 0.7],
]);

/* ---------- STYLES VISUELS ---------- */
style('Animation & dessin', [
  ['anime', 'Anime', 'Style animation japonaise', 'anime style, cel shaded, vibrant colors, clean line art, expressive eyes'],
  ['ghibli', 'Studio Ghibli', 'Aquarelle douce et nature', 'Studio Ghibli style, hand painted watercolor backgrounds, soft warm light, gentle whimsical mood'],
  ['manga', 'Manga noir & blanc', 'Encre et trames', 'black and white manga, ink lines, screentone shading, dynamic composition'],
  ['pixar', '3D façon Pixar', 'Personnages 3D expressifs', 'Pixar style 3D animation, soft global illumination, expressive characters, rich textures'],
  ['cartoon', 'Cartoon américain', 'Aplats colorés', 'classic american cartoon style, bold outlines, flat bright colors, squash and stretch'],
  ['clay', 'Pâte à modeler', 'Stop motion claymation', 'claymation stop motion style, plasticine texture, visible fingerprints, handmade set'],
  ['watercolor', 'Aquarelle', 'Peinture qui coule', 'watercolor painting, flowing pigments, paper texture, soft bleeding edges'],
  ['sketch', 'Croquis au crayon', 'Dessin à la main', 'pencil sketch, graphite hatching, rough lines, paper grain'],
  ['comic', 'Bande dessinée', 'Cases et trames', 'comic book panel style, halftone dots, bold ink, dynamic colors'],
  ['pixelart', 'Pixel art 16 bits', 'Rétro jeu vidéo', '16-bit pixel art, limited palette, crisp pixels, retro game scene'],
  ['lowpoly', 'Low poly', 'Facettes géométriques', 'low poly 3D style, flat shaded triangular facets, minimal gradients'],
  ['papercut', 'Papier découpé', 'Couches de papier', 'layered paper cut-out style, soft shadows between layers, craft texture'],
  ['origami', 'Origami', 'Papier plié', 'origami paper folded style, crisp folds, matte paper colours'],
  ['stained', 'Vitrail', 'Verre et plomb', 'stained glass style, lead lines, luminous translucent colors'],
  ['engraving', 'Gravure', 'Hachures anciennes', 'vintage engraving style, fine crosshatching, ink on aged paper'],
]);
style('Genres de cinéma', [
  ['western', 'Western', 'Poussière et soleil couchant', 'western film, dusty frontier town, golden low sun, cinematic widescreen'],
  ['noirfilm', 'Film noir', 'Ombres et fumée', 'film noir, high contrast black and white, venetian blind shadows, rain and cigarette smoke'],
  ['horror', 'Horreur', 'Ambiance inquiétante', 'horror film, dim flickering light, deep shadows, unsettling atmosphere, fog'],
  ['scifi', 'Science-fiction', 'Futur et technologie', 'science fiction film, sleek futuristic technology, volumetric light, cool tones'],
  ['fantasyfilm', 'Fantasy épique', 'Quête et magie', 'epic fantasy film, majestic landscapes, magical glow, richly detailed costumes'],
  ['thriller', 'Thriller', 'Tension', 'thriller film, tense mood, desaturated palette, handheld realism'],
  ['romance', 'Romance', 'Lumière chaude', 'romantic film, soft warm backlight, shallow depth of field, tender mood'],
  ['documentary', 'Documentaire', 'Naturel et réel', 'documentary look, natural light, candid composition, realistic colors'],
  ['musical', 'Comédie musicale', 'Couleurs et décors de scène', 'musical film, theatrical colorful sets, stage lighting'],
  ['war', 'Film de guerre', 'Poussière et acier', 'war film, gritty desaturated look, smoke, dust and mud'],
  ['spy', 'Espionnage', 'Élégance et gadgets', 'spy thriller, sleek suits, night city, sophisticated gadgets, cold blue light'],
  ['disaster', 'Film catastrophe', 'Chaos et survie', 'disaster blockbuster, huge scale destruction, dramatic lighting'],
]);
style('Univers visuels', [
  ['cyberpunk', 'Cyberpunk', 'Néons, pluie et hologrammes', 'cyberpunk city, neon pink and cyan lights, rain-soaked streets, holograms, dense signage'],
  ['steampunk', 'Steampunk', 'Cuivre, engrenages et vapeur', 'steampunk, brass gears, steam, victorian machinery, warm copper tones'],
  ['gothic', 'Gothique', 'Bougies et brume', 'gothic atmosphere, candlelight, mist, ancient stone, dark romantic mood'],
  ['fantasy', 'Fantasy magique', 'Forêts enchantées', 'enchanted fantasy world, glowing flora, floating lights, magical mist'],
  ['postapo', 'Post-apocalyptique', 'Ruines et nature', 'post apocalyptic world, ruins reclaimed by nature, dusty light, rusted metal'],
  ['space', 'Espace', 'Nébuleuses et planètes', 'deep space, vivid nebulae, planets and stars, cosmic scale'],
  ['underwater', 'Sous-marin', 'Lumière bleue et bulles', 'underwater scene, caustic light rays, drifting particles, deep blue tones'],
  ['synthwave', 'Synthwave années 80', 'Grille néon et soleil rétro', 'synthwave, 80s retro grid horizon, neon sunset, purple and pink gradients'],
  ['vaporwave', 'Vaporwave', 'Statues et dégradés pastel', 'vaporwave aesthetic, pastel gradients, classical statues, glitchy retro motifs'],
  ['solarpunk', 'Solarpunk', 'Ville verte et lumineuse', 'solarpunk city, lush greenery, solar panels, bright optimistic light'],
]);
style('Époques', [
  ['prehistoric', 'Préhistoire', 'Dinosaures et volcans', 'prehistoric world, dinosaurs, lush jungle, volcanic skies'],
  ['egypt', 'Égypte antique', 'Pyramides et pharaons', 'ancient egypt, pyramids, golden sandstone, hieroglyphs, hot light'],
  ['greece', 'Grèce antique', 'Temples et mythes', 'ancient greece, marble temples, mediterranean light, mythological mood'],
  ['rome', 'Rome antique', 'Colisée et légions', 'ancient rome, colosseum, legionaries, warm dusty light'],
  ['medieval', 'Moyen Âge', 'Châteaux et chevaliers', 'medieval, stone castle, knights, banners, misty morning'],
  ['renaissance', 'Renaissance', 'Art et inventeurs', 'italian renaissance, oil painting look, warm tones, workshop of an inventor'],
  ['versailles', 'XVIIIe siècle', 'Versailles et carrosses', '18th century french court, baroque palace, candlelit, silk costumes'],
  ['twenties', 'Années 1920', 'Jazz et Art déco', '1920s, art deco interior, jazz club, gold and black'],
  ['fifties', 'Années 1950', 'Rock n roll et diner', '1950s americana, diner, chrome cars, pastel colors'],
  ['eighties', 'Années 1980', 'Néons et VHS', '1980s, neon lights, arcade, vhs look'],
  ['y2k', 'Années 2000', 'Y2K', 'y2k aesthetic, glossy plastic, early digital graphics, metallic colors'],
  ['future2100', 'Futur 2100', 'Ville high-tech', 'year 2100 megacity, flying vehicles, glass towers, clean futuristic light'],
]);
style('Mouvements artistiques', [
  ['impress', 'Impressionnisme', 'Touches et lumière', 'impressionist painting, visible brush strokes, dappled light, soft colors'],
  ['cubism', 'Cubisme', 'Formes géométriques', 'cubist painting, fragmented geometric planes, multiple viewpoints'],
  ['surreal', 'Surréalisme', 'Rêve et absurde', 'surrealist painting, dreamlike impossible objects, melting forms, Dali inspired'],
  ['popart', 'Pop Art', 'Couleurs vives', 'pop art, Warhol style, bold flat colors, halftone dots'],
  ['artnouveau', 'Art nouveau', 'Courbes florales', 'art nouveau, Mucha style, flowing floral lines, ornate borders'],
  ['artdeco', 'Art déco', 'Géométrie dorée', 'art deco, symmetrical geometry, gold and black, luxurious'],
  ['bauhaus', 'Bauhaus', 'Minimalisme fonctionnel', 'bauhaus design, primary colors, simple geometric shapes'],
  ['expression', 'Expressionnisme', 'Émotion brute', 'expressionist painting, distorted forms, intense saturated colors'],
  ['minimal', 'Minimalisme', 'Épuré', 'minimalist composition, vast empty space, one subject, muted palette'],
  ['baroque', 'Baroque', 'Opulence et théâtre', 'baroque painting, dramatic chiaroscuro, rich ornate details'],
]);
style('Illusions & optique', [
  ['trompe', 'Trompe-l œil', 'L image sort du cadre', 'trompe l oeil, hyper realistic illusion of depth'],
  ['escher', 'Escher', 'Escaliers impossibles', 'Escher style impossible architecture, endless staircases, monochrome'],
  ['kaleido', 'Kaléidoscope', 'Symétrie hypnotique', 'kaleidoscope symmetry, mandala pattern, vivid colors'],
  ['doubleexp', 'Double exposition', 'Deux images fondues', 'double exposure, a silhouette filled with a landscape'],
  ['mirror', 'Réflexion infinie', 'Miroirs en abyme', 'infinite mirror reflections, repeating tunnel of light'],
  ['miniature', 'Effet miniature', 'Maquette tilt-shift', 'tilt-shift miniature effect, toy-like city, shallow focus'],
]);
style('Musique & clips', [
  ['rap', 'Clip rap', 'Urbain et chaînes', 'rap music video, urban street, gold chains, night lights, low angle'],
  ['pop', 'Clip pop', 'Couleurs et confettis', 'pop music video, bright colors, confetti, glossy set'],
  ['rock', 'Clip rock', 'Scène et fumée', 'rock concert, stage smoke, dramatic backlight, crowd'],
  ['edm', 'Clip électro', 'Lasers et foule', 'electronic music festival, lasers, strobe lights, crowd with raised hands'],
  ['jazz', 'Clip jazz', 'Club sombre', 'jazz club, smoky warm light, saxophone, intimate mood'],
  ['classical', 'Concert classique', 'Orchestre et lustres', 'classical concert hall, orchestra, chandeliers, golden light'],
  ['lofi', 'Lo-fi chill', 'Pluie et ambiance calme', 'lofi aesthetic, cozy room at night, rain on the window, soft lamp light'],
  ['reggaeton', 'Reggaeton', 'Plage et couleurs chaudes', 'reggaeton video, beach party, warm tropical colors'],
]);
style('Business, voyage & éducation', [
  ['product', 'Packshot produit', 'Fond neutre premium', 'studio product shot, seamless neutral background, soft reflections, premium look'],
  ['realestate', 'Immobilier', 'Intérieur lumineux', 'real estate photography, bright airy interior, wide angle'],
  ['food', 'Cuisine gourmande', 'Plats appétissants', 'food photography, steam rising, glossy sauce, shallow depth, warm light'],
  ['fashion', 'Lookbook mode', 'Studio de mode', 'high fashion editorial, studio lighting, flowing fabrics'],
  ['postcard', 'Carte postale', 'Voyage vivant', 'vintage travel postcard look, saturated sky, scenic landmark'],
  ['nature', 'Documentaire nature', 'Faune et flore', 'nature documentary, golden hour, rich wildlife detail, telephoto'],
  ['science', 'Explication scientifique', 'Schémas lumineux', 'scientific visualization, glowing diagrams, clean dark background'],
  ['astronomy', 'Astronomie', 'Galaxies et trous noirs', 'astronomy visualization, galaxies, black hole accretion disk, cosmic glow'],
  ['medical', 'Anatomie', 'Organes en 3D', 'medical 3D visualization, translucent anatomy, soft internal glow'],
  ['historical', 'Photo ancienne animée', 'Archive restaurée', 'restored vintage photograph, sepia tones, film grain, period accurate'],
]);

const byId = Object.fromEntries(E.map((e) => [e.slot + ':' + e.id, e]));
const SLOTS = ['motion', 'camera', 'filter', 'trans', 'style'];
module.exports = { EFFECTS: E, byId, SLOTS, find: (slot, id) => byId[slot + ':' + id] || null };
