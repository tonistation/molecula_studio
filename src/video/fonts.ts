import { loadFont } from '@remotion/fonts';
import fontUrl from './assets/fonts/Montserrat[wght].ttf';

export const CAPTION_FONT = 'Molecula Montserrat';

// loadFont owns delayRender/continueRender and cancels rendering on a load failure.
// Module import lets both bundlers include the local OFL font without public/ or a network service.
void loadFont({ family: CAPTION_FONT, url: fontUrl, format: 'truetype', weight: '100 900' });
