// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
// Sostituto di PDF.js usato SOLO nei test: due pagine con il testo dell’Odissea, stessa interfaccia di getDocument/getPage/render.
export const GlobalWorkerOptions = { workerSrc: '' };
const PAGES = [[["Tell me, Muse, about the man who could not find his way home. He had burned", "the high city of Troy, and afterwards he wandered across many seas and saw the", "towns of many peoples. He suffered griefs on the water for the sake of his own", "life and the lives of his companions, yet he could not save them. They", "perished through their own blindness, because they feasted on cattle that were", "not theirs, and the gods took from them the day of their return."], ["Now all the others who had survived the war were at home, safe from the sea.", "Only Odysseus was kept away. The nymph Calypso held him in her hollow cave,", "wanting him for a husband, while he longed for his wife and for the smoke", "rising from the hearths of Ithaca. When the years had turned and the gods", "decided that he should go back, even then his troubles did not end. All the", "gods pitied him except Poseidon, who stayed angry until the hero reached his", "own shore."], ["Meanwhile the gods gathered in the halls of Zeus. The father of gods and men", "spoke among them, and he thought of Aegisthus, who had been killed by the son", "of Agamemnon. Look how mortals blame the gods, he said. They say that evil", "comes from us, yet they bring sorrows on themselves through the blindness of", "their own hearts."]], [["Then Athena, the grey-eyed goddess, answered him. Father, she said, Aegisthus", "earned his ruin. But my heart is torn for Odysseus, who suffers far from his", "friends on an island in the middle of the sea, where Calypso, daughter of", "Atlas, keeps him with soft words so that he forgets Ithaca. Yet he longs only", "to see the smoke rising from his own land, and then to die. Why are you so", "angry with him, Zeus?"], ["Zeus replied that he had not forgotten Odysseus. It is Poseidon, he said, who", "holds a grudge, because Odysseus blinded his son the Cyclops. Let us plan his", "return together, so that Poseidon must give up his anger. Athena then asked", "that Hermes be sent to Calypso, to tell her that Odysseus must go home, while", "she herself would go to Ithaca to wake the courage of his son Telemachus."], ["So Athena bound on her golden sandals and flew down from Olympus to Ithaca. At", "the door of the house of Odysseus she found the suitors of his wife, Penelope,", "playing games and feasting on cattle that were not theirs. Telemachus sat", "among them, sad at heart, dreaming that his father might come home and drive", "them from the halls."]]];
const mc = new OffscreenCanvas(1, 1).getContext('2d');
function vp(scale) { return { width: 612 * scale, height: 792 * scale, scale, transform: [scale, 0, 0, -scale, 0, 792 * scale] }; }
function items(p) {
  const out = []; let y = 730;
  const add = (str, size) => { mc.font = size + 'px serif'; out.push({ str, transform: [size, 0, 0, size, 72, y], width: mc.measureText(str).width, height: size, hasEOL: true, fontName: 'f1' }); y -= size * 1.5; };
  if (p === 1) { add('The Odyssey, Book I', 22); y -= 8; }
  for (const para of PAGES[p - 1]) { for (const l of para) add(l, 11); y -= 8; }
  return out;
}
export function getDocument() {
  return { promise: Promise.resolve({ numPages: 2, getMetadata: async () => ({ info: { Title: 'The Odyssey, Book I' } }), getPage: async (p) => {
    const its = items(p);
    return {
      getViewport: ({ scale }) => vp(scale),
      getTextContent: async () => ({ items: its, styles: { f1: { fontFamily: 'serif' } } }),
      render: ({ canvasContext: ctx, viewport, transform }) => ({ promise: (async () => {
        if (transform) ctx.setTransform(...transform);
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, viewport.width, viewport.height); ctx.fillStyle = '#111';
        const s = viewport.scale;
        for (const it of its) { ctx.font = (it.transform[0] * s) + 'px serif'; ctx.fillText(it.str, it.transform[4] * s, (792 - it.transform[5]) * s); }
      })() })
    };
  } }) };
}
