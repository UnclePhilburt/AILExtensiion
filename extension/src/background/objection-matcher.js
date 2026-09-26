// Local, rule-based objection matching (no AI model, nothing leaves the
// computer). Only the short recognised text of one utterance is examined; no
// audio or transcript is saved.
//
// How a transcript is matched:
// 1. normalise: lowercase, strip punctuation, expand contractions and
//    speech-to-text spellings (dont, im, gonna...), fix small misspellings of
//    key words (edit distance 1, or 2 for long words).
// 2. every objection has an "anchor" check (e.g. a first-person negation next
//    to remember/recall/sign up/fill out) and "veto" checks for ordinary rep
//    talk ("do you remember...", "if you're not interested...", "your zip code").
// 3. words are mapped to shared concepts (this/that/it, remember/recall,
//    do/did/sign up/fill out, mail/send/email...) and the utterance is scored
//    against natural variants by weighted, in-order token overlap.
// 4. the best objection above the threshold wins. His saved phrases still
//    match directly (subject to the same vetoes).

export const MATCH_THRESHOLD = 0.75;
export const OBJECTION_COOLDOWN_MS = 20000; // same objection
export const ANY_OBJECTION_COOLDOWN_MS = 4000; // any objection

// Salebase rebuttal titles, exactly as written on the script page. Each rule
// lists every title that answers it (one per script that has it); the page
// opens whichever one the selected script shows. `prefer` puts more specific
// titles first for particular wordings; `crossScript: false` means "only open
// when the selected script has it" (no text borrowed from another script).
const T = {
  notInterested: "I'm not interested.", notInterestedLapsed: 'Not interested...', dontWant: "I don't want it.",
  mail: 'Can you mail it to me?', mailLapsed: 'Just mail it...',
  forgotChild: "I don't remember doing this!", forgotWill: "I don't remember filling this out.", forgotCard: "I don't remember any card.",
  forgotPlus: "If they don't remember the letter or filling out the card…",
  zoomChild: 'Do we have to do a Zoom meeting? / Do I have to do this? / Why do I have to do this?', zoomFe: 'Why do we have to do it by zoom or virtual call?',
  meetFe: 'Why do we have to meet a benefits coordinator?',
  whatIsThis: 'What is this all about?', confused: 'After first objection where there is ANY confusion…',
  howLong: 'How long will this take?', howLongPlus: 'How long is this going to take?', howLongLapsed: 'How long is this going to take...',
  cost: 'How much will this cost?', tooExpensive: "No way, we already got quotes and it's too expensive.",
  freeFe: 'How is it free? Why is it free?', freeWill: 'What is in it for you? Or how is it free? Or are you going to try to sell me something?',
  cantTalk: "I can't talk right now. / I'm at work.", driving: "I'm driving, at work, or busy!", callBack: 'Can you call me back?',
  rightNow: 'Do I have to do this right now?', notToday: "I can't do it today!", badTime: "That time won't work.",
  notBuyingSell: "We're not buying anything. / Are you trying to sell me something?", notBuying: "We're not buying anything.",
  sellInsurance: 'Are you trying to sell me insurance?', sellPlus: 'Are you going to try to sell me something...',
  sellLapsed: 'Is someone going to try and sell me something/someone always wants to come out and sell me more insurance...',
  sellFe: "You're not going to try and sell me anything are you?",
  spouse: 'Why does my spouse need to be there?', spouseLapsed: 'Why does my spouse have to be there...', single: 'If they are single...',
  union: "I'm not part of the union anymore.", needHelp: "I don't need help filling it out.",
  haveWill: 'I already have one set up.', haveKit: 'I already have a Child Safe Kit.', haveGlobe: 'I already have Globe Life:',
  orderedLongAgo: 'I ordered these a while ago.', twoPart: 'What is the two part program?', spokeAlready: 'I already spoke with someone.',
  everyYear: 'You guys do this every year...', trust: 'If they sound nervous or hesitant (trust issue)...',
  dollarPolicy: 'I thought it was the $1 insurance policy? Or I sent in my application already.', shopping: 'I was just shopping around.'
};
const SELL_TITLES = [T.notBuyingSell, T.sellPlus, T.sellFe, T.sellLapsed, T.freeWill, T.sellInsurance, T.notBuying];
const SPOUSE = '(spouse|wife|husband|partner|significant other|boyfriend|girlfriend|fiance|fiancee)';

// Rep talk shared by the newer objections: talking about "you"/"they"/"people".
const REP_TALK = [
  /\b(if|when|unless|whether|in case|even if) (you|they|he|she|someone|somebody|anyone|anybody|people|folks)\b/,
  /\b(a lot of|lots of|most|many|some|other) (people|folks|members|families|customers|clients|couples)\b/,
  /\bif i were you\b/, /\b(make|force|pressure) you\b/, /\bthe reason (i am|we are|for my)\b/
];

const RULES = [
  {
    id: 'not-interested',
    priority: 0, // generic: loses ties to a more specific objection
    label: T.notInterested,
    titles: [T.notInterested, T.notInterestedLapsed, T.dontWant],
    prefer: [
      [/\b(not|never)\b(?: \w+){0,2} want (it|this|that|them|one|any|the kit|the kits|a will|the will)$/, [T.dontWant]],
      [/\b(buy|buying|purchase)\b/, [T.notBuyingSell, T.notBuying]]
    ],
    phrases: ['not interested', 'no interest', "don't want it", 'do not want it'],
    variants: [
      "I'm not interested", 'not interested', 'we are not interested', 'I am not really interested', 'no interest',
      'I have no interest in that', "I'm not interested in that", "I'm not interested in anything", 'no thank you not interested',
      "I don't want it", "I don't want that", "I don't want any", "I don't need it", "I don't need that", "we don't need anything",
      "I don't want to do this", "I don't want to buy anything", 'no thanks', 'no thank you', 'not for me', 'not for us',
      "I'm not looking for anything", 'I am no longer interested', 'stop calling me', 'take me off your list', 'remove me from your list',
      "I'm not interested in insurance", "we don't want any insurance"
    ],
    anchors: [
      /\b(not|no|never|nothing|zero)\b(?: \w+){0,2} (interested|interest)\b/,
      /\b(not|never)\b(?: \w+){0,2} (want|need)\b(?: (it|this|that|them|any|anything|one|insurance|coverage|policy|nothing|none|more))?(?:$| (it|this|that|any|anything|one|insurance|coverage|policy|nothing))/,
      /\b(not|never) (want|need) to (buy|do|sign|hear|talk|get|pay|continue|go|deal|meet|set)\b/,
      /\bno (thank you|thanks)\b/, /\bnot for (me|us)\b/, /\bnot looking (for|to)\b/,
      /\bstop calling\b/, /\b(take|remove) (me|us) (off|from)\b/
    ],
    vetoes: [
      /\b(if|when|unless|maybe|in case) you\b/, /\byou (are|were|would be) not\b/, /\bare you (not )?interested\b/,
      /\b(not|never) want to (be rude|bother|interrupt|keep|waste|take up|miss|lose|hurt|forget)\b/,
      /\bnot only\b/, /\bnot interested in (the |a |doing )?(zoom|video|meeting|computer)/, /\bdo not need to\b(?! (buy|do|sign|hear|talk|get|pay|continue|go|meet|set))/,
      // Rebuttal answers the rep reads out ("I wouldn't be interested if I were you either",
      // "I can't make you do anything you don't want to do", "not something you want to lose").
      /\bif i were\b/, /\b(make|force|pressure) you\b/, /\bnot (something|anything) (you|we)\b/, /\byou do not (want|need)\b/
    ]
  },
  {
    id: 'mail-it',
    priority: 1,
    label: T.mail,
    titles: [T.mail, T.mailLapsed],
    phrases: ['mail it to me', 'send it in the mail', 'send me information', 'mail me information'],
    variants: [
      'send the information to me', 'can you mail it to me', 'just mail it to me', 'mail me the information', 'mail me something', 'send it in the mail',
      'put it in the mail', 'send me some information', 'can you send me something', 'can you just send me the information',
      'send me the info and I will look at it', 'email it to me', 'can you email me the details', 'email me the information',
      'send me a brochure', 'send it to my house', 'can I get that in the mail', 'can I get it in writing',
      'do you have something you can send me', 'can you send me something in the mail', 'send it to me', 'mail it'
    ],
    anchors: [
      /\b(mail|send|email|post|ship|text)\b.*\b(me|us|myself)\b/, /\b(me|us)\b.*\b(mail|send|email)\b/,
      /\bin the mail\b/, /\bin writing\b/, /\b(mail|send|email) (it|this|that|them)( to (me|us|my \w+))?$/
    ],
    vetoes: [
      /\b(mail|send|email|text|ship|post)\w*\b(?: \w+){0,3} (to )?you\b(?!.*\b(me|us)\b)/,
      /\b(sent|mailed|got|received|already|emailed)\b(?: \w+){0,4} (mail|email)\b/, /\bmy (email|mailing address|address|e mail)( address)? is\b/,
      /\b(your|the) (email|mailing|address)\b/, /\bdid you (get|receive)\b/, /\b(send|mail|email) (it|this|that)? ?over\b/, /\bto (my|the|our) (manager|supervisor|office|team|agent|boss)\b/, /\b(we|i) (will|are going to|can) (mail|send|email)\b/,
      /\bwe used to\b/
    ]
  },
  {
    id: 'forgot',
    priority: 1,
    label: T.forgotChild,
    titles: [T.forgotChild, T.forgotWill, T.forgotCard, T.forgotPlus],
    prefer: [[/\bcard\b/, [T.forgotCard]]],
    phrases: ["don't remember", 'do not remember', 'never did this', "didn't do this"],
    variants: [
      "I don't remember doing this", "I don't remember doing that", "I don't remember that", "I don't remember",
      "I don't recall signing up for this", "I don't recall doing that", "I don't recall", 'I never did that', 'I never did this',
      "I didn't do this", "I don't remember filling that out", "I didn't fill anything out", 'I never filled out a card',
      'I never signed up for anything', 'I never sent that in', "I didn't request this", "I didn't ask for this", 'I never asked for this',
      'I have no recollection of this', 'I have no memory of that', 'I forgot about that', 'I forgot', "I can't remember doing that",
      "I don't think I did that", "I don't think I signed up for that", "that wasn't me", 'we never ordered anything', 'nobody here filled that out',
      "I don't remember sending that in", "I don't remember requesting anything", "I don't remember any card", "I don't remember getting a letter",
      "I don't remember filling this out", 'what card', 'I never got a card'
    ],
    anchors: [
      /\b(not|never|no)\b(?: \w+){0,3} (remember|recall|recollect|recollection|memory)\b/,
      /\b(i|we)\b(?: \w+){0,3} (forgot|forget|forgotten)\b/,
      /\b(not|never)\b(?: \w+){0,3} (do|did|done|doing|sign|signed|signing|fill|filled|filling|request|requested|ask|asked|send|sent|mail|mailed|order|ordered|register|registered|enroll|enrolled|apply|applied|submit|submitted|return|returned|agree|agreed)\b/,
      /\b(that|it|this) (was|is) not (me|us)\b/,
      /\b(nobody|no one|none of us)\b(?: \w+){0,3} (do|did|filled|signed|sent|requested|ordered|asked|mailed)\b/,
      /^(?:(?:um|uh|oh|what|wait|huh) )*what card\b/, /\b(never|not) (got|get|received|receive|seen|see) (a|any|the|that) (card|letter)\b/
    ],
    vetoes: [
      /\byou (do |did |may |might |probably |just )?(not|never)\b/, /\b(do|did|can|could) you (remember|recall)\b/, /\bif you\b/,
      /\b(remember|recall|forgot|forget)\b(?: \w+){0,3} (zip|code|address|number|name|birthday|birth|date|password|email|social|pin|street|age|phone)\b/,
      /\b(people|folks|most|many|they|customers|everyone|some|lot)\b(?: \w+){0,2} (not|never) (remember|recall)\b/,
      /\bnot (do|did) (it|this|that) yet\b/, /\bnot remember (you|your)\b/, /\bnot (mean|want|need) to\b/,
      /\b(can|could|do|did|will|would|should) not (we|i)\b/,
      // Rebuttal answers: "we do not do any paid advertising", "not everyone was filling them out",
      // "the paperwork wasn't filled out", "I'm not allowed to do that over the phone".
      /\bnot do any\b/, /\bnot everyone\b/, /\b(paperwork|application|form|forms|it|policy) (was|were|is|has) not (been )?(filled|done|completed|submitted|updated|signed)\b/,
      /\bnot allowed\b/, /\bdid not (use|get to use)\b/, /\bdo not do\b/, /\b(make|force|pressure) you\b/, /\byou do not want\b/
    ]
  },
  {
    id: 'zoom',
    priority: 2,
    label: T.zoomChild,
    titles: [T.zoomChild, T.zoomFe, T.meetFe],
    prefer: [
      [/^(?!.*\b(zoom|video|virtual|virtually|online|computer|camera|facetime|skype)\b).*\b(meet|meeting with|coordinator|appointment|come out|someone|somebody)\b/, [T.meetFe]],
      [/\b(virtual|virtually|online)\b/, [T.zoomFe]]
    ],
    phrases: ['zoom meeting', 'do i have to do this', 'why do i have to do this', 'have to do this'],
    variants: [
      'do we have to do a zoom meeting', 'do I have to do a zoom meeting', 'do we have to do a zoom', 'is this a zoom call',
      'is this on zoom', 'can we do this without zoom', "I don't do zoom", "I don't have zoom", "I don't have a computer",
      "I don't know how to use zoom", "can't we just do it over the phone", 'can we just do this on the phone', 'do I have to do this',
      'why do I have to do this', 'do I need to do this', 'why do I need to do this', 'is this required', 'is this mandatory', 'is the zoom required', "I don't want to do a zoom meeting",
      'do I have to', 'do we need a video call', 'does it have to be on video', 'does it have to be a zoom meeting',
      "I'm not good with computers", 'do we really have to meet', 'why do we have to meet', 'why do I have to meet with someone',
      'can we skip the zoom', 'a zoom meeting', 'zoom meeting',
      'why do we have to do it by zoom', 'why does it have to be virtual', 'why is it virtual', 'can we do it in person', 'can someone come to my house',
      'why do we have to meet a benefits coordinator', 'who is the benefits coordinator', 'what is a benefits coordinator',
      'why can not you just tell me over the phone', 'why do I have to meet with anybody'
    ],
    anchors: [
      /\b(do|does|why|must|will|would|should)\b (i|we)\b(?: \w+){0,2} (have to|has to|need to|got to|supposed to)\b/,
      /\bwhy (do|would|should|must) (i|we) (need|have|do|meet)\b/,
      /\b(is|does) (this|it|that|the zoom|the meeting|the video|zoom)\b(?: \w+){0,2} (required|mandatory|necessary|have to be|need to be)\b/,
      /\b(i|we)\b(?: \w+){0,3} not\b(?: \w+){0,4} (zoom|video|computer|computers|laptop|camera|webcam|facetime|skype)\b/,
      /\b(without|instead of|other than|skip) (the |a )?(zoom|video|computer|meeting)\b/,
      /^(?:(?:so|but|and|wait|well|okay|oh|um|uh) )*(do|does|is|are|can|could|will|would|why|must) (i|we|this|it|that)\b.*\b(zoom|video|facetime|skype|computer|webcam|camera)\b/,
      /\b(just|rather|instead|only)\b.*\b(over|on) the phone\b/, /\b(can|could) (we|i|not we)\b.*\b(over|on) the phone\b/,
      /\bbenefits? coordinator\b/, /\bwhy (is|does) (it|this|the meeting) (have to be )?(virtual|online|on zoom|by zoom)\b/,
      /\b(can|could) (we|you|someone|somebody) (do it|do this|meet|come)\b.*\b(in person|my house|my home|to me)\b/,
      /\bwhy can not you just (tell|explain|do)\b/
    ],
    vetoes: [
      /\ball (you|we) (have|need) to do\b/, /^(?:(?:so|but|and|okay|well) )*(do|does|can|could|will|would|are|is) you\b/,
      /\byou (have|need|will need|would need|will have) to\b/, /\b(we will|i will|let us|we can|we are going to)\b(?: \w+){0,4} (zoom|meeting)\b/,
      /\b(right now|today|tonight)\b/, /\bneeds to be done by\b/, /\b(have|has|need|got) to (pay|spend|buy|sign|give)\b/, /\byour benefits? coordinator (will|is going to|can)\b/
    ]
  },
  {
    id: 'what-is-this',
    priority: 1,
    label: T.whatIsThis,
    titles: [T.whatIsThis, T.confused],
    phrases: ['what is this all about', 'what is this about', 'what is this'],
    variants: [
      'what is this all about', 'what is this about', 'what is this', 'what is this regarding', 'what is this call about',
      'what is this for', 'what is this in reference to', 'what are you calling about', 'what are you calling for', 'what are you calling me for', 'why are you calling me',
      'who is this', 'who is calling', 'what company is this', 'what company are you with', 'what do you want', 'what are you selling',
      "I don't know what this is", 'I have no idea what this is', 'what exactly is this', 'what is going on', 'what is it about',
      'what is this concerning', 'what is the call about', 'what is this even about', "what's this all about"
    ],
    anchors: [
      /\bwhat(?: \w+)? is (this|it|that)\b/, /\bwhat (are|were) you calling (me |us )?(about|for)\b/, /\bwhy are you calling\b/,
      /\bwhat is (the|this) call (about|regarding|for)\b/, /\bwho is (this|calling|that)\b/, /\bwhat company\b/,
      /\bwhat (are|were) you selling\b/, /\bwhat do you want\b/, /\b(not|no)\b(?: \w+){0,2} (know|idea|clue) what (this|it|that) is\b/,
      /\bwhat (is|are) you (talking|calling) about\b/, /\bwhat is going on\b/, /\bwhat was (this|it|that) (about|for|regarding)\b/
    ],
    vetoes: [
      /\bwhat was (that|it)\b(?! (about|for|regarding))/, /\b(let me|i will|i am going to|i want to|i can|i would like to|i will just) (tell|explain|show|go over|share)\b/,
      /\bwhat (it|this|that) is( all)? about is\b/, /\bwhat is (it|that|this) (that )?you\b/, /\bwhat is (it|that|this) like\b/,
      /\bwhat did you say\b/,
      /\bwhat is (this|that) (weekend|week|morning|afternoon|evening|month|year|time|number|date|address|day)\b/, /\blooking like\b/,
      /\bwhat is (in|the catch)\b/, /\bwhat is (this|the|that) (two|2) part\b/
    ]
  },
  {
    id: 'confused',
    priority: 0,
    label: T.confused,
    titles: [T.confused, T.whatIsThis],
    crossScript: false,
    phrases: ['i am confused', 'i do not understand'],
    variants: [
      "I'm confused", "I'm so confused", "I'm a little confused", "I'm kind of confused", "I don't understand", "I don't understand what this is",
      "I don't get it", "I'm lost", 'you lost me', "I'm not following", "I don't follow", 'this does not make sense', 'that makes no sense',
      "I'm not sure what you mean", 'what do you mean', 'what policy', 'what renewal', 'what letter', "I don't know anything about this",
      'I have no idea what you are talking about', 'I do not understand what you are saying', 'none of this makes sense'
    ],
    anchors: [
      /\bi am (so |a little |a bit |kind of |really |very |totally |getting )?(confused|lost)\b/, /\b(not|never) (understand|follow|following|get it)\b/,
      /\b(makes|make) no sense\b/, /\bnot make (any )?sense\b/, /\byou lost me\b/, /\bwhat do you mean\b/,
      /^(?:(?:um|uh|oh|wait|huh|sorry) )*what (policy|renewal|letter|membership)\b/, /\bnot know anything about (this|that|it)\b/,
      /\b(no|not) (idea|clue|sure) what you (are|mean)\b/
    ],
    vetoes: [...REP_TALK, /\b(you|they) (are|were|might be|may be|seem|sound|got) (\w+ ){0,3}confused\b/, /\bdo you (understand|follow)\b/,
      /\bdoes (that|this|it) make sense\b/, /\bwhat do you mean by\b(?! that)/, /\bso you (do not|understand)\b/]
  },
  {
    id: 'how-long',
    priority: 2,
    label: T.howLong,
    titles: [T.howLong, T.howLongPlus, T.howLongLapsed],
    phrases: ['how long will this take', 'how long is this going to take', 'how long does it take'],
    variants: [
      'how long will this take', 'how long is this going to take', 'how long does this take', 'how long will it take', 'how long is the meeting',
      'how long is it', 'how much time will this take', 'how much time is this going to take', 'how long do you need', 'how long will the zoom be',
      'how long is the zoom meeting', 'is this going to take long', 'will this take long', 'is it going to take a long time', 'this is not going to take long is it',
      'how many minutes', 'how long are we talking', 'how long will it last', 'how long does the appointment take', 'is this going to be quick',
      'will it be quick', 'how much of my time', 'I do not have a lot of time how long is this', 'how long is this call'
    ],
    anchors: [
      /\bhow (long|much time|many minutes|many hours)\b/, /\b(take|takes|taking|last|lasts|be) (very |too |that |a )?(long|while|forever)\b.*$/,
      /\b(going to|will|is) (it|this|that) (be |take )?(quick|fast|long)\b/, /\bhow much of (my|our) time\b/
    ],
    vetoes: [...REP_TALK, /\bhow long (have|has|ago|since|did|were|was|you|your|is your)\b/, /\bit (only |just )?takes? (about |around |like |maybe )?(\w+ )?(minutes|seconds|hour|hours)\b/,
      /\b(not|never) (take|takes|be) (very |that |too )?long\b/, /\bwill not take\b/, /\bdoes not take\b/, /\bthe meeting (is|takes|lasts) about\b/,
      /\b(took|taken|taking) (so|this|that) long\b/, /\blong enough\b/, /\bhow long (ago|before)\b/, /\bnot long at all\b/]
  },
  {
    id: 'cost',
    priority: 2,
    label: T.cost,
    titles: [T.cost, T.tooExpensive],
    phrases: ['how much will this cost', 'how much does it cost', 'how much is this going to cost'],
    variants: [
      'how much will this cost', 'how much does it cost', 'how much is it', 'how much is this going to cost me', 'what does it cost', 'what will it cost',
      'what is the cost', 'what is the price', 'is there a cost', 'is there a fee', 'do I have to pay', 'do I have to pay anything', 'how much do I have to pay',
      'is this going to cost me money', 'what is this going to cost me', 'is there a charge', 'how much money is this', 'am I going to have to pay for this',
      'how much are the premiums', 'how much is the insurance', 'what is this going to cost', 'does this cost anything', 'will I have to pay for it'
    ],
    anchors: [
      /\bhow much\b(?! (time|longer|of (my|our|your) time))/,
      /^(?:(?:um|uh|oh|so|and|but|well|okay|wait) )*(what|is|does|do|will|am|are|how)\b.*\b(cost|costs|price|fee|fees|charge|charges|pay|premium|premiums)\b/,
      /\b(cost|charge) (me|us) (anything|money|something)\b/
    ],
    vetoes: [...REP_TALK, /\b(no|not|without|zero) (cost|charge|fee|price)\b/, /\b(it|this|that|they) (is|are) (completely |totally |absolutely |100 percent )?free\b/,
      /\byou (do not|will not|never) (have to )?pay\b/, /\b(does|will) not cost\b/, /\bpaid (for|by)\b/, /\bhow much \w+ (do|did|would) you\b/,
      /\bhow much (you|your)\b/, /\btoo (much|expensive)\b/, /\b(how|why) (is|would|can|could) (it|this|that) (be )?free\b/, /\bhow much (life insurance|coverage) (do|would)\b/,
      /\b(pays|pay) (for|out|up to)\b/, /\bif (i|we) (die|pass|passed)\b/]
  },
  {
    id: 'too-expensive',
    priority: 3,
    label: T.tooExpensive,
    titles: [T.tooExpensive, T.cost],
    phrases: ['too expensive', 'already got quotes', 'can not afford it'],
    variants: [
      "it's too expensive", "that's too expensive", 'way too expensive', 'we already got quotes', 'we got a quote and it was too much', 'the quote was too high',
      'it costs too much', "that's too much money", "I can't afford it", "we can't afford that", "I can't afford insurance right now", "no way it's too expensive",
      'we already looked at the prices', 'it was too pricey', 'the price was way too high', 'money is tight right now', "we don't have the money",
      "I'm on a fixed income", "it's more than we can afford", 'no way we already got quotes and it is too expensive'
    ],
    anchors: [
      /\btoo (expensive|pricey|costly|high)\b/, /\b(costs?|price|quote|quotes|premium|premiums|that is|it is|it was|was) (way |much |just )?too much\b/, /\btoo much money\b/,
      /\b(not|never) afford\b/, /\b(got|get|had|have|gotten) (a |some |the |our |many |several )?quotes?\b/,
      /\bfixed income\b/, /\bmoney is (tight|short)\b/, /\b(not|no) have (the |any |that kind of |enough )?money\b/, /\bmore than (we|i) can afford\b/
    ],
    vetoes: [...REP_TALK, /\btoo much (time|trouble|for you|of your)\b/, /\b(does|will) not cost\b/, /\byou can afford\b/, /\bthe quote (you|we)\b/,
      /\bnot (too|that) expensive\b/, /\bis (it|that|this) (too )?expensive\b/, /\bcould not afford\b/]
  },
  {
    id: 'free',
    priority: 3,
    label: T.freeFe,
    titles: [T.freeFe, T.freeWill],
    phrases: ['how is it free', 'why is it free', 'what is the catch', 'what is in it for you'],
    variants: [
      'how is it free', 'why is it free', 'how can it be free', 'why would you give it away for free', "what's the catch", "there's got to be a catch",
      'nothing is free', "nothing's ever free", "what's in it for you", 'what do you get out of it', 'what do you get out of this', 'why are you giving this away',
      'how do you make money', 'how do you guys make money off this', "if it's free what's the catch", 'that sounds too good to be true', 'why free',
      'how is this free', 'why would it be free', 'where is the catch'
    ],
    anchors: [
      /\b(how|why) (is|would|can|could|are) (it|this|that|these|they) (be |being )?free\b/, /\bwhat is the catch\b/, /\b(there is|there has|got to be|always) (got to be |gotta be )?a catch\b/, /\bwhere is the catch\b/,
      /\bnothing is (ever )?free\b/, /\bin it for (you|them|your company)\b/, /\b(you|they) get out of (it|this|that)\b/, /\bhow do (you|they) make (any )?money\b/,
      /\btoo good to be true\b/, /\bgiv(e|ing) (it|this|that|these|them) away\b/, /^(?:(?:um|uh|oh|so|but|wait) )*why free\b/
    ],
    vetoes: [...REP_TALK, /\bthat is how (we|they)\b/, /\bthis is how we\b/]
  },
  {
    id: 'busy-now',
    priority: 2,
    label: T.cantTalk,
    titles: [T.cantTalk, T.driving, T.callBack],
    prefer: [[/\b(driving|car|road|busy)\b/, [T.driving]]],
    phrases: ['i am at work', 'i am driving', 'can not talk right now'],
    variants: [
      "I can't talk right now", "I can't talk", "I'm at work", "I'm at work right now", "I'm working", "I'm on the clock", "I'm driving", "I'm driving right now",
      "I'm in the car", "I'm busy", "I'm busy right now", "I'm kind of busy", "this isn't a good time", "now's not a good time", "it's not a good time",
      'bad time', "I don't have time right now", "I don't have time for this", "I'm in the middle of something", "I'm with a customer", "I'm at the doctor",
      "I'm on my lunch break", 'I only have a minute', "I'm about to walk into a meeting", "I can't really talk", 'I gotta go', "I'm driving at work or busy"
    ],
    anchors: [
      /\b(not|never) (really )?talk\b/, /\bi am (currently |actually |still |just )?(at|in|on) (work|the car|a meeting|the road|the clock|my lunch|lunch|the doctor|the hospital|a call|the other line|the job|my way)\b/,
      /\bi am (currently |actually |still |kind of |really |pretty |so |very |a little )?(driving|working|busy|swamped|slammed|cooking|eating|at work)\b/, /\b(not|never) (a )?(good|great) time\b/, /\bbad time\b/,
      /\b(not|no) have (the |any )?time\b/, /\bin the middle of\b/, /\bwith a (customer|client|patient)\b/, /\bonly have a (minute|second|few minutes)\b/,
      /\b(have to|got to) go( now| right now)?$/, /\babout to (walk|go) into\b/
    ],
    vetoes: [...REP_TALK, /\bis (this|now|it) a (good|bad) time\b/, /\byou (are|were) (at work|driving|busy|working)\b/, /\bnot have time to (explain|go over|cover)\b/,
      /\bi am not (busy|working|driving|at work)\b/, /\bkeep (it|this) (short|quick|brief)\b/, /\bbusy so (i|we)\b/, /\b(it depends on|questions you have)\b/, /\b(know|understand) (you are|how) busy\b/, /\bwhile (you|i) (are|am) (driving|working)\b/]
  },
  {
    id: 'call-back',
    priority: 2,
    label: T.callBack,
    titles: [T.callBack, T.cantTalk, T.driving, T.notToday],
    phrases: ['call me back', 'call me later'],
    variants: [
      'can you call me back', 'call me back', 'call me back later', 'can you call me later', 'call me another time', 'call me tomorrow', 'can you call back in an hour',
      'try me later', 'can you call me back tonight', 'give me a call later', 'call back later', 'can I call you back', 'let me call you back', 'can you call me after work',
      'could you call me back in like twenty minutes', 'now is not good call me back', 'call me next week', 'can we talk later', 'call me in a little bit', 'try back later'
    ],
    anchors: [
      /\bcall (me|us) (back|later|tomorrow|tonight|another|next|after|in|on|around|at)\b/, /\b(can|could|would|will) you call (me |us )?back\b/, /\bcall (me |us )?back\b/,
      /\b(can i|could i|let me|i will have to|i will need to) call you back\b/, /\btry (me |us )?(back |again )?(later|tomorrow|tonight)\b/, /\bgive (me|us) a call (later|back|tomorrow|tonight)\b/,
      /\b(talk|speak) later\b/
    ],
    vetoes: [...REP_TALK, /\b(i will|we will|i can|let me|should i|may i|want me to|would you like me to|for me to|i am going to) call you\b(?! back$)/, /\bwhen (is|would be|can|should)\b.*\bcall\b/,
      /\b(agent|coordinator|someone|they|he|she|office|we) (will|is going to|can|would) call\b/, /\bis this a good time\b/, /\bcall you back (at|on) (this|that|the)\b/]
  },
  {
    id: 'right-now',
    priority: 3,
    label: T.rightNow,
    titles: [T.rightNow, T.notToday, T.zoomChild, T.callBack],
    phrases: ['do i have to do this right now', 'does it have to be right now'],
    variants: [
      'do I have to do this right now', 'do we have to do this now', 'does it have to be right now', 'do I need to do it right now', 'does it have to be today',
      'can it wait', 'can this wait', 'can we do this later', 'can we do this another time', 'can I do this later', 'can we do it some other time', 'why right now',
      'does this have to happen now', 'can we reschedule', 'do I have to decide right now', 'can I do it on my own time', 'right now?', 'does it have to be now',
      'can we do it later'
    ],
    anchors: [
      /\b(have to|has to|need to|needs to|must|got to)\b(?: \w+){0,4} (right now|now|today|tonight|right away|immediately|this minute)\b/,
      /\b(can|could) (it|this|that) wait\b/, /\b(can|could) (we|i) (do|finish|handle) (it|this|that) (later|another time|some other time|another day|some other day)\b/,
      /\breschedule\b/, /^(?:(?:um|uh|oh|so|but|wait) )*(why )?right now$/, /\bon my own time\b/
    ],
    vetoes: [...REP_TALK, /\b(we|i) can (do|get|set) (this|it|that)( done| up)? (right )?now\b/, /\byou do not have to (decide|do|pay|sign|commit|buy)\b/,
      /\byou (have|need) to\b/, /\b(let us|let me|we will|i will)\b.*\b(right now|today)\b/, /\bdo you want to reschedule\b/]
  },
  {
    id: 'not-today',
    priority: 3,
    label: T.notToday,
    titles: [T.notToday, T.badTime, T.rightNow, T.callBack],
    phrases: ['can not do it today', 'can not do today', 'today does not work'],
    variants: [
      "I can't do it today", "I can't do today", "today doesn't work", "today's not good", 'not today', 'today is bad for me', "I can't today", "I'm busy today",
      'I have plans today', "today won't work", 'can we do it tomorrow', 'can we do another day', "I can't do it this week", 'maybe another day',
      'how about tomorrow instead', 'not today maybe next week', 'I work today', "I won't be home today", 'today is not a good day', 'not today'
    ],
    anchors: [
      /\b(not|never)\b(?: \w+){0,3} (today|this week|tonight)\b/, /\b(today|tonight|this week)\b(?: \w+){0,3} (not|bad|busy|no good)\b/, /\b(another|different|other) day\b/,
      /\b(tomorrow|next week) instead\b/, /\bi am busy (today|tonight|this week)\b/, /\bplans (today|tonight|this week)\b/, /\bi work (today|tonight)\b/,
      /\b(can|could) we (do it |do this |do that )?(tomorrow|next week|another day)\b/
    ],
    vetoes: [...REP_TALK, /\byou do not have to (decide|do|pay|sign|commit|buy)\b/, /\bnot (decide|sign|pay|buy|commit)\w*\b/, /^(would|does|will|is|how about|what about) (today|tomorrow)\b.*\b(work|good|better)\b/,
      /\bwhat (time|day)\b/, /\b(not|no) (\w+ )?(obligation|pressure|commitment)\b/]
  },
  {
    id: 'bad-time',
    priority: 2,
    label: T.badTime,
    titles: [T.badTime, T.notToday, T.callBack],
    phrases: ['that time will not work', 'that time does not work'],
    variants: [
      "that time won't work", "that time doesn't work", "that time doesn't work for me", "that won't work for me", "that doesn't work for me", "I can't do that time",
      "I can't make that time", "I'm not available then", 'I work then', "I'm working at that time", "that's too early", "that's too late", 'can we do a different time',
      'can we do another time', 'do you have anything later', 'do you have anything earlier', "I won't be home then", "we're busy then", "that day doesn't work",
      'neither of those work', 'none of those times work', 'can we do a different day'
    ],
    anchors: [
      /\b(time|times|day|days|that|those|then|neither|none|saturday|sunday|monday|tuesday|wednesday|thursday|friday|morning|evening|afternoon)\b(?: \w+){0,3} (not|never) (work|good)\b/,
      /\b(will|does|do) not work for (me|us)\b/, /\b(not|never) (make|do) (that|those|this) (time|day|times)\b/, /\bnot available\b/,
      /\b(i|we) (am|are|will be)? ?(working|busy|home|out|away|gone)\b(?: \w+){0,2} (then|at that time)\b/, /\bi work then\b/, /\b(that is|it is|that was) too (early|late)( for (me|us))?$/,
      /\b(different|another|other|later|earlier) (time|times)\b/, /\banything (later|earlier)\b/, /\b(neither|none) of (those|them|these|the times)\b/, /\bnot be home then\b/
    ],
    vetoes: [...REP_TALK, /\b(does|would|will) (that|this|it|either|saturday|sunday|today|tomorrow|one)\b(?: \w+){0,3} work (for|better)\b/, /\bwhat time\b/, /\bwhich (time|day|one)\b/,
      /\bif (that|this|neither|none)\b/, /\b(no|not) (matter|problem)\b/, /\bdo you (have|work)\b(?! anything)/]
  },
  {
    id: 'not-buying',
    priority: 3,
    label: T.notBuyingSell,
    titles: [T.notBuyingSell, T.notBuying, T.sellFe, T.sellPlus, T.sellLapsed],
    phrases: ['not buying anything', 'we are not buying'],
    variants: [
      "we're not buying anything", "I'm not buying anything", "we're not buying", "we don't buy anything over the phone", "I don't buy over the phone",
      "I'm not going to buy anything", "we're not looking to buy anything", "I'm not purchasing anything", "I won't buy anything", 'not buying', "we're not in the market",
      "I'm not spending any money", "we're not going to buy insurance", "we're not buying any insurance", "we don't buy things from phone calls", "I am not buying"
    ],
    anchors: [/\b(not|never)\b(?: \w+){0,3} (buy|buying|purchase|purchasing|spend|spending)\b/, /\bnot in the market\b/],
    vetoes: [...REP_TALK, /\byou (are|do|will|would) not (have to )?(\w+ )?(buy|buying|purchase|spend)\b/, /\b(no one|nobody) is (asking|going to ask|trying to (make|get))\b/,
      /\bnot (asking|trying to get|going to ask|here to (make|get)) you\b/, /\bnot a sales\b/, /\bthere is nothing to buy\b/, /\bnot (have|need) to buy\b/, /\bnot ready to buy\b/, /\bnot want to buy\b/]
  },
  {
    id: 'selling',
    priority: 2,
    label: T.notBuyingSell,
    titles: SELL_TITLES,
    prefer: [[/\b(insurance|policy|policies|coverage)\b/, [T.sellInsurance, T.sellLapsed]], [/\b(free|in it for)\b/, [T.freeWill]]],
    phrases: ['trying to sell me', 'try to sell me', 'is this a sales call', 'sell me something'],
    variants: [
      'are you trying to sell me something', 'are you going to try to sell me something', "you're not going to try and sell me anything are you",
      'is someone going to try to sell me something', 'is this a sales call', 'is this a sales pitch', 'are you trying to sell me insurance', 'are you selling insurance',
      'someone always wants to come out and sell me more insurance', 'is this a sales thing', "I don't want a sales pitch", 'is this going to be a sales pitch',
      'are they going to try to sell me something', 'is the agent going to sell me something', 'will they try to sell me stuff', "you're just going to try to sell me something",
      'this sounds like a sales call', 'is there going to be a sales pitch', 'I know you are going to try to sell me something', 'is this insurance', 'is this about insurance'
    ],
    anchors: [
      /\b(sell|selling|sold)\b(?: \w+){0,2} (me|us)\b/, /\bsales (call|pitch|thing|guy|person|presentation)\b/, /\b(try|trying|going) (and|to) sell\b/,
      /\bsell(ing)? (insurance|policies|a policy)\b/, /^(?:(?:um|uh|oh|so|wait|and) )*is (this|it) (about |an |some )?(insurance|a policy)\b/
    ],
    vetoes: [...REP_TALK, /\b(not|never)\b(?: \w+){0,3} (a )?sales (call|pitch)\b/, /\b(i|we) (am|are|will|would) not\b(?: \w+){0,3} sell\b/, /\bsell you\b/,
      /\bno sales\b/, /\b(nobody|no one) (is going to|will) (try to )?sell\b/, /\bwhat (are|were) you selling\b/, /\bcan not make you\b/]
  },
  {
    id: 'spouse',
    priority: 2,
    label: T.spouse,
    titles: [T.spouse, T.spouseLapsed],
    phrases: ['why does my spouse need to be there', 'why does my wife have to be there', 'why does my husband have to be there'],
    variants: [
      'why does my spouse need to be there', 'why does my husband have to be there', 'why does my wife need to be there', 'does my wife have to be there',
      'does my husband need to be on the call', 'can I just do it without my wife', 'can I do it by myself', 'can I do this alone', "my husband doesn't need to be there",
      'why do you need my wife', 'why do you need both of us', 'do we both have to be there', 'does my partner need to join', "my wife can't make it",
      'can I just do it and tell my husband', 'why both of us', 'do both of us need to be on', 'my husband works nights', 'my wife is never home',
      'why does my spouse have to be there'
    ],
    anchors: [
      new RegExp(`\\bmy ${SPOUSE}\\b(?: \\w+){0,4} (have to|has to|need to|needs to|be there|be on|join|make it|home|there|works|working|busy|not)\\b`),
      new RegExp(`\\b(why|do|does|can not|without|instead of)\\b(?: \\w+){0,5} (my )?${SPOUSE}\\b`), /\b(both of us|we both|the two of us)\b/,
      /\b(can|could) i\b(?: \w+){0,3} (by myself|alone|on my own|without)\b/
    ],
    vetoes: [...REP_TALK, new RegExp(`\\byour ${SPOUSE}\\b`), new RegExp(`\\bdo you have a ${SPOUSE}\\b`), new RegExp(`\\b${SPOUSE} (is|are) (also )?(covered|a beneficiary|listed)\\b`),
      /\bcheck with my\b/, /\bhandles the\b/, /\bthe reason\b/, /\bis (also )?important\b/, /\bthank you\b/]
  },
  {
    id: 'single',
    priority: 3,
    label: T.single,
    titles: [T.single],
    crossScript: false,
    phrases: ['i am single', 'i am not married'],
    variants: [
      "I'm single", "I'm not married", "I don't have a spouse", "I'm divorced", "I'm widowed", 'my wife passed away', 'my husband passed away', 'I live alone',
      "it's just me", "there's no spouse", "I'm not married anymore", "we're not married", "we're separated", 'I have no wife', 'I have no husband', 'I am a widow',
      "I don't have a wife", "I don't have a husband"
    ],
    anchors: [
      /\bi am (single|divorced|widowed|a widow|a widower|separated|not married)\b/, /\b(we are|i am) (not|never) (been )?married\b/, /\b(not|never) (been )?married\b/,
      new RegExp(`\\b(not|no) have a ${SPOUSE}\\b`), new RegExp(`\\bhave no ${SPOUSE}\\b`), new RegExp(`\\bno ${SPOUSE}\\b`),
      new RegExp(`\\bmy ${SPOUSE} (passed|died|is deceased|is gone|left)\\b`), /\blive (alone|by myself)\b/, /\bit is just me\b/
    ],
    vetoes: [...REP_TALK, /\b(if|whether) (you|they) are\b/, /\bare you (single|married)\b/, /\byou are (single|married|not married)\b/, /\bmarried or not\b/, /\bgotten married\b/]
  },
  {
    id: 'union',
    priority: 3,
    label: T.union,
    titles: [T.union],
    phrases: ['not part of the union', 'not in the union anymore', 'left the union'],
    variants: [
      "I'm not part of the union anymore", "I'm not in the union anymore", "I'm not a member anymore", 'I left the union', 'I quit the union', "I'm retired", 'I retired',
      "I don't work there anymore", "I'm no longer with the union", "I'm no longer a member", "I haven't been in the union for years", 'I got out of the union',
      'I dropped out of the union', "I'm not with that local anymore", 'I changed jobs', "I don't belong to the union", "we're not union", 'I was never in a union',
      "I don't pay dues anymore", "I'm not a union member"
    ],
    anchors: [
      /\b(not|never|no longer)\b(?: \w+){0,4} (union|member|members|membership|local|dues)\b/, /\b(left|quit|dropped out of|got out of|out of) (the |that |my )?(union|local)\b/,
      /\bi (am|got) retired\b/, /\bi retired\b/, /\b(not|never) work (there|for them)\b/, /\bchanged jobs\b/
    ],
    vetoes: [...REP_TALK, /\b(your|the) (union|local) (is|has|provides|sent|pays|made)\b/, /\byou are (no longer|not|still)\b/, /\bpermanent\b/, /\bthrough (your|the) (union|group)\b/]
  },
  {
    id: 'need-help',
    priority: 3,
    label: T.needHelp,
    titles: [T.needHelp],
    phrases: ['do not need help', 'i can fill it out myself'],
    variants: [
      "I don't need help filling it out", "I don't need help", 'I can fill it out myself', 'I can do it myself', 'I can do it on my own', "I'll fill it out myself",
      'I know how to fill it out', "I don't need anyone to help me", "just send it and I'll do it", "I don't need you to walk me through it", 'I can figure it out',
      'we can handle it ourselves', "I don't need someone to explain it", 'I can read the instructions', "I don't need assistance", "we don't need help with it",
      "I'll do it on my own", "it's pretty self explanatory"
    ],
    anchors: [
      /\b(not|never)\b(?: \w+){0,2} need (any |your |some )?(help|assistance|anyone|anybody|someone|somebody|you to)\b/,
      /\b(do|fill|figure|handle|complete) (it|this|that|them)( out)? (myself|ourselves|on (my|our) own)\b/,
      /\b(i|we) (can|will|know how to) (fill|do|figure|handle|complete|read)\b(?: \w+){0,3} (myself|ourselves|own|out|instructions)\b/, /\bself explanatory\b/
    ],
    vetoes: [...REP_TALK, /\byou (do not|will not|never) need\b/, /\bdo you need\b/, /\bif you need\b/, /\bneed (help|anything) (from|else)\b/]
  },
  {
    id: 'already-have',
    priority: 2,
    label: T.haveWill,
    titles: [T.haveWill, T.haveKit, T.haveGlobe],
    crossScript: false,
    phrases: ['i already have one', 'i already have a will', 'i already have globe life'],
    variants: [
      'I already have one set up', 'I already have a will', 'we already have a will', 'we already did our wills', 'my lawyer already did our will', 'I already have a trust',
      'I already have one', 'we already have one', 'we already have that', 'I already have a child safe kit', 'we already got the kit', 'we already have the kits',
      'I already have Globe Life', "I'm already with Globe", 'I already have a policy with Globe', 'I already have life insurance', 'I already have insurance',
      "we're already covered", 'I have one already'
    ],
    anchors: [
      /\balready (have|got|did|done|own|bought|made|set up|have got|with|covered|insured)\b/, /\b(have|got) (one|it|that|those|them|a will|a kit|the kit|globe|globe life) already\b/
    ],
    vetoes: [...REP_TALK, /\byou already\b/, /\balready have your\b/, /\balready (sent|mailed|spoke|talked|told|said|mentioned|applied|called)\b/, /\b(this|last) year\b/,
      /\bwe already have (you|your)\b/]
  },
  {
    id: 'ordered-long-ago',
    priority: 3,
    label: T.orderedLongAgo,
    titles: [T.orderedLongAgo],
    phrases: ['ordered these a while ago', 'that was a long time ago'],
    variants: [
      'I ordered these a while ago', 'I ordered that a long time ago', 'that was a long time ago', 'that was months ago', 'that was ages ago', 'I requested that forever ago',
      'I sent that in a long time ago', 'that was over a year ago', 'I filled that out a long time ago', 'why is it taking so long', "it's been months",
      'that was so long ago', 'I asked for that way back', 'it took you long enough', "I'd given up on it", 'why did it take so long', 'I ordered them last year'
    ],
    anchors: [
      /\b(i|we) (\w+ ){0,2}(ordered|requested|sent|filled|asked|signed|mailed|applied)\b(?: \w+){0,5} (ago|last year|way back)\b/, /\bthat was (\w+ ){0,3}ago\b/,
      /\b(take|taking|took) (you )?(so|this|that) long\b/, /\b(took|take) (you )?long enough\b/, /\bgiven up on\b/, /\bit (has|is) been (months|a year|years|forever|ages)\b/
    ],
    vetoes: [...REP_TALK, /\byou (\w+ ){0,2}(filled|ordered|requested|sent|signed|did|wrote)\b/, /\bso you might\b/, /\blast time your\b/]
  },
  {
    id: 'two-part',
    priority: 3,
    label: T.twoPart,
    titles: [T.twoPart],
    crossScript: false,
    phrases: ['two part program', 'what are the two parts'],
    variants: [
      'what is the two part program', "what's the two part program", 'what are the two parts', 'what do you mean two parts', 'two parts?', "what's part two",
      'what is the second part', "what's the other part", 'what are the two steps', "what's the two step thing", 'tell me about the two part program', "what's the second step",
      'what do you mean by two part program', 'what is part two of this', 'explain the two part thing', 'what are the two parts of it',
      'which two parts', 'how does the two part program work', 'what is the other part of the program', 'what comes in the second part'
    ],
    anchors: [
      /\b(what|which|how|explain|tell me|mean)\b(?: \w+){0,5} ((two|2) (part|parts|step|steps)|part (two|2)|(second|other) (part|step|half))\b/,
      /^(?:(?:um|uh|oh|so|wait) )*(two|2) (parts|part program|steps)$/
    ],
    vetoes: [...REP_TALK, /\b(it|this) is a (two|2) (part|step)\b/, /\bthe (first|second) (part|step) (is|of)\b/]
  },
  {
    id: 'spoke-already',
    priority: 3,
    label: T.spokeAlready,
    titles: [T.spokeAlready],
    phrases: ['already spoke with someone', 'already talked to someone', 'already spoke to someone'],
    variants: [
      'I already spoke with someone', 'I already talked to someone', 'I already talked to somebody', 'someone already called me', 'somebody already called',
      'I just talked to you guys', 'I already spoke to an agent', 'I talked to someone yesterday', 'I already had this call', 'you guys already called me',
      'I already got a call about this', 'I already did this with someone', 'someone called me last week', 'I already went over this', 'I spoke to someone already',
      'another agent already called', 'I already talked to your company', 'you already called me'
    ],
    anchors: [
      /\balready (spoke|spoken|talked|talk|had (a |this |that )?call|got a call|went over|called)\b/, /\b(spoke|talked|spoken) (to|with) (someone|somebody|an agent|a guy|a lady|a woman|you|your|someone else|another)\b/,
      /\b(someone|somebody|another agent|you|another guy|a guy|a lady) (already |just )?called (me|us)?\b(?: \w+){0,3} (already|yesterday|last|before|earlier|this morning)?/
    ],
    guard: /\balready\b|\byesterday\b|\blast (week|month|time)\b|\bbefore\b|\bearlier\b|\bthis morning\b|\bjust (talked|spoke|called)\b/,
    vetoes: [...REP_TALK, /\bwhen we spoke\b/, /\bas (we|i) (discussed|talked|spoke)\b/, /\byou (spoke|talked) (to|with)\b/, /\bi (called|spoke|talked) (to|with)? ?you\b/,
      /\bthey (asked|wanted) me\b/]
  },
  {
    id: 'every-year',
    priority: 3,
    label: T.everyYear,
    titles: [T.everyYear],
    phrases: ['do this every year', 'we did this last year'],
    variants: [
      'you guys do this every year', 'you call every year', "didn't we just do this", 'we did this last year', 'we just did this', 'we already did this last year',
      'why do you call every year', 'you guys call me every year', 'we do this every year', "I've done this before", 'we went through this last time',
      'same thing as last year', 'somebody comes out every year', 'you called last year too', "haven't we done this already", "every year it's the same thing"
    ],
    anchors: [
      /\bevery (single )?year\b/, /\blast (year|time)\b/, /\b(just|already) (did|done|went through) (this|that|it)\b/, /\bdone this (before|already)\b/, /\bsame (thing|call) (as|again|every)\b/,
      /\b(did|done|do) (this|that|it) (just |already )?(before|already)\b/
    ],
    guard: /\b(did|done|do|call|called|calls|comes|went|same|again|every)\b/,
    vetoes: [...REP_TALK, /\b(we|i) (review|update|check|contact|look at|go over)\b(?: \w+){0,4} every year\b/, /\blast time (your|you|the policy)\b/, /\bwas (last )?updated\b/,
      /\b(this|that) is why\b/]
  },
  {
    id: 'trust',
    priority: 3,
    label: T.trust,
    titles: [T.trust],
    phrases: ['is this a scam', 'how do i know this is legit'],
    variants: [
      'is this a scam', 'this sounds like a scam', 'how do I know this is legit', "how do I know you're legit", 'how do I know you are who you say you are',
      "I don't trust this", "I don't give out my information over the phone", "I don't give my information out", 'how did you get my number', 'how did you get my information',
      'where did you get my information', 'is this real', 'is this for real', 'this sounds fishy', "I've been scammed before", "I'm not comfortable with this",
      "I'm nervous about this", 'are you legit', 'is this legitimate', 'this seems suspicious', 'I do not trust people on the phone'
    ],
    anchors: [
      /\b(scam|scams|scammed|scammer|scammers|fraud|fishy|suspicious|legit|legitimate|sketchy|shady)\b/, /\bhow (do|would|can) i know\b/, /\b(not|never) trust\b/,
      /\b(not|never) give (out )?(my|our|any|personal)\b/, /\b(how|where) did you get my\b/, /\bis (this|it) (real|for real)\b/, /\bnot comfortable\b/,
      /\bi am (nervous|worried|scared|uneasy|skeptical|leery|wary)\b/
    ],
    vetoes: [...REP_TALK, /\bwe will never ask\b/, /\b(not|never) a scam\b/, /\byou (can|might|may) (be )?(nervous|worried)\b/, /\btrust us\b/, /\bhow do i know (if|when|what|which|where)\b/]
  },
  {
    id: 'dollar-policy',
    priority: 3,
    label: T.dollarPolicy,
    titles: [T.dollarPolicy],
    phrases: ['one dollar policy', 'one dollar insurance', 'sent in my application'],
    variants: [
      'I thought it was the one dollar insurance policy', 'I thought this was the dollar policy', 'what about the one dollar policy', 'where is my one dollar policy',
      'I thought it was a dollar', 'I sent in my application already', 'I already sent in my application', 'I already applied', 'I already filled out the application',
      'I mailed my application', 'I thought I already signed up', "didn't I already apply", 'I already paid the dollar', 'I thought it was only a dollar',
      'the ad said one dollar', 'the commercial said a dollar for the first month', 'what happened to my application', "I'm waiting on my policy"
    ],
    anchors: [
      /\b(one|1|a|only a|just a) dollar\b/, /\b1 (insurance|policy|dollar)\b/, /\b(the|that|this) dollar (insurance|policy|plan|thing|deal|offer)\b/, /\b(sent|mailed|filled out|submitted|turned in|sent in|did) (in )?(my|the|our) application\b/,
      /\balready (applied|sent in|submitted|mailed in|signed up|paid)\b/, /\bmy application\b/, /\bwaiting (on|for) (my|the) policy\b/, /\bi already (\w+ )?apply\b/
    ],
    vetoes: [...REP_TALK, /\byour application\b/, /\bthe application (you|that you)\b/]
  },
  {
    id: 'shopping',
    priority: 3,
    label: T.shopping,
    titles: [T.shopping],
    phrases: ['just shopping around', 'i was just looking'],
    variants: [
      'I was just shopping around', "I'm just shopping around", "I'm just looking", 'I was just looking at prices', 'I was just comparing prices', "I'm comparing quotes",
      'I just wanted a quote', 'I just wanted to see the prices', 'I was just curious', 'I was just checking rates', 'I was only browsing', "I'm shopping for insurance",
      "I'm getting quotes from different companies", "I'm looking at other companies", "I was just seeing what's out there", "I'm not ready to buy yet",
      "we're still looking around", 'I wanted to compare'
    ],
    anchors: [
      /\bshopping( around)?\b/, /\b(just|only) (looking|browsing|curious|checking|comparing|wanted a quote|wanted to see|seeing)\b/, /\bcompar(e|ing)\b/,
      /\b(getting|get) (some |a few |other |different )?quotes\b/, /\blooking around\b/, /\bnot ready to buy\b/, /\bwhat is out there\b/, /\bother companies\b/
    ],
    vetoes: [...REP_TALK, /\byou (can|could|may|might) compare\b/, /\bcompared to\b/]
  }
];

const CONTRACTIONS = [
  [/\b(can ?not|can'?t)\b/g, 'can not'], [/\bwon'?t\b/g, 'will not'], [/\bain'?t\b/g, 'am not'],
  [/\b(do|does|did|is|are|was|were|have|has|had|would|could|should|must|need)n'?t\b/g, '$1 not'],
  [/\bi'?m\b/g, 'i am'], [/\bi'?ve\b/g, 'i have'], [/\bi'd\b/g, 'i would'], [/\bi'll\b/g, 'i will'],
  [/\b(you|we|they)'re\b/g, '$1 are'], [/\byoure\b/g, 'you are'], [/\btheyre\b/g, 'they are'],
  [/\b(you|we|they)'ll\b/g, '$1 will'], [/\b(you|we|they)'ve\b/g, '$1 have'], [/\b(you|we|they)'d\b/g, '$1 would'],
  [/\b(what|that|it|who|there|where|how|here)'?s\b/g, '$1 is'], [/\b(today|tonight|tomorrow)'?s\b/g, '$1 is'], [/\blet'?s\b/g, 'let us'],
  [/\bgonna\b/g, 'going to'], [/\bwanna\b/g, 'want to'], [/\bgotta\b/g, 'got to'], [/\bhafta\b/g, 'have to'],
  [/\bkinda\b/g, 'kind of'], [/\bsorta\b/g, 'sort of'], [/\blemme\b/g, 'let me'], [/\bgimme\b/g, 'give me'],
  [/\bdunno\b/g, 'do not know'], [/\b(nope|nah|naw)\b/g, 'no'], [/\b(u|ya)\b/g, 'you'], [/\byou (guys|folks|people)\b/g, 'you'], [/\by'?all\b/g, 'you all'],
  [/\b(un|dis)interested\b/g, 'not interested'], [/\bsign ?up\b/g, 'sign up'], [/\bsignup\b/g, 'sign up'],
  [/\bface ?time\b/g, 'facetime'], [/\bvideo ?call\b/g, 'video call'], [/\binfo\b/g, 'information']
];

// Key words that small speech-to-text misspellings are corrected to.
const VOCABULARY = ['remember', 'remembered', 'remembering', 'recall', 'recollect', 'recollection', 'interested', 'interest',
  'information', 'brochure', 'meeting', 'computer', 'required', 'mandatory', 'necessary', 'requested', 'request', 'signed',
  'filled', 'calling', 'regarding', 'concerning', 'reference', 'facetime', 'forgot', 'forget', 'email', 'mailed', 'anything',
  'something', 'supposed', 'insurance', 'company', 'selling', 'recall', 'ordered', 'registered', 'mandatory',
  'expensive', 'afford', 'coordinator', 'spouse', 'husband', 'union', 'shopping', 'program', 'married', 'legitimate', 'comparing', 'application'];
const VOCAB_SET = new Set(VOCABULARY);

const CONCEPTS = [
  // multi-word first
  [['sign', 'up'], '~do'], [['signed', 'up'], '~do'], [['signing', 'up'], '~do'], [['fill', 'out'], '~do'], [['filled', 'out'], '~do'],
  [['filling', 'out'], '~do'], [['fill', 'in'], '~do'], [['filled', 'in'], '~do'], [['send', 'in'], '~do'], [['sent', 'in'], '~do'],
  [['mail', 'in'], '~do'], [['mailed', 'in'], '~do'], [['send', 'back'], '~do'], [['sent', 'back'], '~do'], [['mailed', 'back'], '~do'],
  [['ask', 'for'], '~do'], [['asked', 'for'], '~do'], [['have', 'to'], '~haveto'], [['has', 'to'], '~haveto'], [['need', 'to'], '~haveto'],
  [['needs', 'to'], '~haveto'], [['got', 'to'], '~haveto'], [['supposed', 'to'], '~haveto'], [['how', 'come'], '~why'],
  [['video', 'call'], '~zoom'], [['in', 'reference', 'to'], '~about'], [['in', 'regards', 'to'], '~about'], [['no', 'longer'], '~not'],
  [['my', 'house'], '~me'], [['my', 'home'], '~me'], [['my', 'address'], '~me'], [['in', 'writing'], '~mail'],
  // single words
  [['this'], '~this'], [['that'], '~this'], [['it'], '~this'], [['these'], '~this'], [['those'], '~this'], [['them'], '~this'],
  ...['remember', 'remembered', 'remembering', 'recall', 'recalled', 'recalling', 'recollect', 'recollection', 'memory'].map((w) => [[w], '~remember']),
  ...['forgot', 'forget', 'forgotten'].map((w) => [[w], '~forgot']),
  ...['do', 'does', 'did', 'done', 'doing', 'sign', 'signed', 'signing', 'fill', 'filled', 'filling', 'request', 'requested', 'requesting',
    'order', 'ordered', 'register', 'registered', 'enroll', 'enrolled', 'apply', 'applied', 'submit', 'submitted', 'return', 'returned',
    'ask', 'asked', 'agree', 'agreed'].map((w) => [[w], '~do']),
  ...['mail', 'mailed', 'mailing', 'send', 'sending', 'sent', 'email', 'emailed', 'emailing', 'post', 'ship', 'text'].map((w) => [[w], '~mail']),
  ...['information', 'details', 'brochure', 'pamphlet', 'paperwork', 'packet', 'literature', 'material', 'materials', 'something',
    'anything', 'stuff', 'letter'].map((w) => [[w], '~info']),
  ...['interested', 'interest'].map((w) => [[w], '~interest']),
  ...['want', 'need', 'needs'].map((w) => [[w], '~want']),
  ...['not', 'never', 'no', 'nothing', 'none', 'zero', 'nobody'].map((w) => [[w], '~not']),
  ...['zoom', 'video', 'facetime', 'skype', 'teams', 'webcam', 'camera', 'computer', 'computers', 'laptop', 'online', 'virtual'].map((w) => [[w], '~zoom']),
  ...['meeting', 'meet', 'appointment', 'session', 'conference'].map((w) => [[w], '~meeting']),
  ...['must', 'required', 'require', 'mandatory', 'necessary', 'obligated'].map((w) => [[w], '~haveto']),
  ...['why'].map((w) => [[w], '~why']),
  ...['about', 'regarding', 'concerning'].map((w) => [[w], '~about']),
  ...['calling', 'call', 'called', 'phoning'].map((w) => [[w], '~call']),
  ...['me', 'us', 'myself'].map((w) => [[w], '~me']),
  ...['i', 'we'].map((w) => [[w], '~i']),
  ...['spouse', 'wife', 'husband', 'partner', 'boyfriend', 'girlfriend'].map((w) => [[w], '~spouse']),
  ...['cost', 'costs', 'price', 'prices', 'fee', 'fees', 'charge', 'pay', 'premium', 'premiums'].map((w) => [[w], '~cost']),
  ...['buy', 'buying', 'purchase', 'purchasing'].map((w) => [[w], '~buy']),
  ...['sell', 'selling', 'sales', 'sold'].map((w) => [[w], '~sell']),
  ...['someone', 'somebody', 'anyone', 'anybody'].map((w) => [[w], '~someone']),
  ...['talk', 'talked', 'spoke', 'spoken', 'speak'].map((w) => [[w], '~talk'])
];

const STOPWORDS = new Set(['a', 'an', 'the', 'um', 'uh', 'uhm', 'umm', 'er', 'ah', 'oh', 'well', 'like', 'just', 'really', 'actually',
  'honestly', 'so', 'okay', 'ok', 'yeah', 'yes', 'sir', 'maam', 'mam', 'please', 'all', 'ever', 'even', 'exactly', 'again', 'for', 'of',
  'at', 'with', 'is', 'am', 'are', 'be', 'been', 'being', 'can', 'could', 'would', 'will', 'should', 'shall', 'may', 'might', 'any',
  'some', 'any', 'out', 'up', 'hey', 'hi', 'hello', 'look', 'listen', 'honey', 'dear', 'buddy', 'man', 'now', 'right', 'then', 'very',
  'kind', 'sort', 'think', 'guess', 'mean', 'know', 'you know']);

const KEY_WEIGHT = 2;

function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, current[j]);
    }
    if (best > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

function correctWord(word) {
  if (word.length < 5 || VOCAB_SET.has(word)) return word;
  const max = word.length >= 8 ? 2 : 1;
  let best = word; let bestDistance = max + 1;
  for (const candidate of VOCABULARY) {
    if (candidate[0] !== word[0]) continue;
    const distance = editDistance(word, candidate, max);
    if (distance < bestDistance) { best = candidate; bestDistance = distance; }
  }
  return best;
}

// Lowercase, strip punctuation, expand contractions/STT spellings, fix typos.
export function normalizeTranscript(transcript) {
  let text = String(transcript || '').toLowerCase().replace(/[\u2018\u2019\u02bc`\u00b4]/g, "'").replace(/e-mail/g, 'email');
  text = text.replace(/[^a-z0-9'\s]/g, ' ');
  for (const [pattern, replacement] of CONTRACTIONS) text = text.replace(pattern, replacement);
  return text.replace(/'/g, '').split(/\s+/).filter(Boolean).map(correctWord).join(' ');
}

function toConcepts(normalized) {
  const words = normalized.split(' ').filter(Boolean);
  const out = [];
  for (let index = 0; index < words.length;) {
    let matched = null;
    for (const [pattern, concept] of CONCEPTS) {
      if (pattern.every((word, offset) => words[index + offset] === word)) { matched = [pattern.length, concept]; break; }
    }
    if (matched) { out.push(matched[1]); index += matched[0]; continue; }
    if (!STOPWORDS.has(words[index])) out.push(words[index]);
    index += 1;
  }
  return out;
}

const weightOf = (token) => (token.startsWith('~') || ['what', 'who', 'zoom', 'phone', 'company', 'selling', 'long', 'free', 'catch', 'union', 'scam', 'today', 'busy', 'driving', 'work', 'expensive', 'afford', 'quotes', 'already', 'single', 'married'].includes(token) ? KEY_WEIGHT : 1);

// Weighted in-order overlap of a variant inside a window of the utterance.
function variantScore(variant, tokens) {
  const total = variant.reduce((sum, token) => sum + weightOf(token), 0);
  if (!total || !tokens.length) return 0;
  const windowSize = variant.length + 2;
  let best = 0;
  for (let start = 0; start < Math.max(1, tokens.length - windowSize + 1); start += 1) {
    const window = tokens.slice(start, start + windowSize);
    const table = Array.from({ length: variant.length + 1 }, () => new Array(window.length + 1).fill(0));
    for (let i = 1; i <= variant.length; i += 1) {
      for (let j = 1; j <= window.length; j += 1) {
        table[i][j] = variant[i - 1] === window[j - 1]
          ? table[i - 1][j - 1] + weightOf(variant[i - 1])
          : Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
    best = Math.max(best, table[variant.length][window.length] / total);
    if (best === 1) break;
  }
  return best;
}

const prepareRule = (rule) => ({
  rule,
  savedPhrases: rule.phrases.map(normalizeTranscript),
  variantTokens: [...rule.phrases, ...rule.variants].map((variant) => toConcepts(normalizeTranscript(variant))).filter((tokens) => tokens.length)
});
const PREPARED = RULES.map(prepareRule);

function prepareCustom(customPhrases) {
  if (!customPhrases || typeof customPhrases !== 'object') return {};
  const out = {};
  for (const [id, list] of Object.entries(customPhrases)) {
    const phrases = (Array.isArray(list) ? list : [list]).map((value) => String(value || '').trim()).filter(Boolean).slice(0, 50);
    out[id] = { saved: phrases.map(normalizeTranscript), tokens: phrases.map((phrase) => toConcepts(normalizeTranscript(phrase))).filter((t) => t.length) };
  }
  return out;
}

// ---- Generic fallback for rebuttal titles no rule knows yet --------------------
// A rebuttal added on Salebase later is still matched from its own title words
// ("I just lost my job." -> "i just lost my job"), but strictly: nearly all of
// the title's meaningful words in order, in a short first-person utterance, and
// never in rep talk. Rep notes like "If they are single..." are skipped.
const compactTitle = (title) => String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const KNOWN_TITLES = new Set(RULES.flatMap((rule) => rule.titles || [rule.label]).map(compactTitle));
const GENERIC_THRESHOLD = 0.9;
const MINOR_TOKENS = new Set(['~i', '~this', '~me', '~someone', '~info']);
const meaningful = (tokens) => tokens.filter((token) => !MINOR_TOKENS.has(token));
const GENERIC_VETOES = [...REP_TALK, /you (are|were|will|would|should|can|could|might|may|do|did|have|need)(?! (trying|going to try))/, /your/, /(we|i) (will|can|are going to|would like to)/];
const REP_NOTE = /^(if|after|when|once|before|for|note|tip|remember|reminder|rebuttal|always|never)\b/i;

export function titleAlternatives(title) {
  return String(title || '').replace(/[…]+|\.{2,}/g, ' ').split(/\s*\/\s*|[?!:;]\s*(?:or\s+)?|\.\s+|\s+or\s+(?=(?:how|why|what|are|is|do|can|i|we)\b)/i)
    .map((part) => part.replace(/^or\s+/i, '').trim()).filter(Boolean);
}

const genericCache = new Map();
function genericRule(title, allowKnown = false) {
  const key = compactTitle(title);
  const cacheKey = `${allowKnown ? 1 : 0}:${key}`;
  if (genericCache.has(cacheKey)) return genericCache.get(cacheKey);
  let rule = null;
  if (key && (allowKnown || !KNOWN_TITLES.has(key)) && !REP_NOTE.test(String(title).trim())) {
    const variants = titleAlternatives(title).map((part) => toConcepts(normalizeTranscript(part)))
      .filter((tokens) => meaningful(tokens).length >= 2 && tokens.length >= 3);
    if (variants.length) rule = { id: `title:${key.slice(0, 60)}`, label: String(title).trim(), titles: [String(title).trim()], phrases: [], variants, priority: -1, crossScript: true };
  }
  genericCache.set(cacheKey, rule);
  return rule;
}

function matchGeneric(transcript, titles, allowKnown = false) {
  const normalized = normalizeTranscript(transcript);
  if (!normalized || GENERIC_VETOES.some((veto) => veto.test(normalized))) return null;
  const tokens = toConcepts(normalized);
  let best = null;
  for (const title of titles || []) {
    const rule = genericRule(title, allowKnown);
    if (!rule) continue;
    for (const variant of rule.variants) {
      if (tokens.length > variant.length + 4) continue; // short utterances only
      const score = variantScore(variant, tokens);
      // Every meaningful title word must be said, and negation must agree both ways.
      const allWords = meaningful(variant).every((word) => tokens.includes(word)) && tokens.includes('~not') === variant.includes('~not');
      if (score >= GENERIC_THRESHOLD && allWords && (!best || score > best.score)) best = { rule, score };
    }
  }
  return best;
}

// Titles to try on the page for this match, most specific first.
function titlesFor(rule, normalized) {
  const preferred = (rule.prefer || []).filter(([pattern]) => pattern.test(normalized)).flatMap(([, titles]) => titles);
  return [...new Set([...preferred, ...(rule.titles || [rule.label])])];
}

// Scores every objection for one utterance. Exposed for tests and debugging.
// (Variants are only scored for objections whose anchor or saved phrase fits.)
export function scoreObjections(transcript, options = {}) {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) return [];
  const tokens = toConcepts(normalized);
  const custom = prepareCustom(options.customPhrases);
  const padded = ` ${normalized} `;
  return PREPARED.map(({ rule, savedPhrases, variantTokens }) => {
    const extra = custom[rule.id] || { saved: [], tokens: [] };
    const saved = [...savedPhrases, ...extra.saved].find((phrase) => phrase && padded.includes(` ${phrase} `)) || '';
    const vetoText = options.vetoContext || normalized;
    const anchored = rule.anchors.some((anchor) => anchor.test(normalized)) && (!rule.guard || rule.guard.test(normalized));
    // A saved phrase said on its own (e.g. "a zoom meeting?") counts even
    // without an anchor; inside a longer sentence it needs one.
    // (Only for the whole utterance: a window cut from rep talk is not "alone".)
    const savedAlone = !options.vetoContext && Boolean(saved) && normalized.split(' ').length <= saved.split(' ').length + 2;
    let score = 0;
    let vetoed = false;
    if (anchored || savedAlone || options.fullScores) {
      vetoed = rule.vetoes.some((veto) => veto.test(vetoText));
      for (const variant of [...variantTokens, ...extra.tokens]) {
        score = Math.max(score, variantScore(variant, tokens));
        if (score === 1) break;
      }
      if (saved) score = 1;
    }
    const matched = !vetoed && (anchored || savedAlone) && score >= MATCH_THRESHOLD;
    return { id: rule.id, label: rule.label, score: Math.round(score * 100) / 100, anchored, vetoed, saved: Boolean(saved), matched, priority: rule.priority };
  }).sort((a, b) => Number(b.matched) - Number(a.matched) || b.score - a.score || b.priority - a.priority);
}

// On speakerphone one final result often merges the rep's question and the
// customer's answer ("do you remember filling that out no i dont remember
// doing this"). A rep-talk veto must only block the words near it, so any
// utterance longer than a short phrase is also checked in overlapping windows,
// each with a few words of preceding context for the vetoes.
const WINDOW_WORDS = 8;
const WINDOW_CONTEXT_WORDS = 4;
const LONG_UTTERANCE_WORDS = 6;

export function matchObjection(transcript, options = {}) {
  if (options.onlyTitles) return matchGenericOnly(transcript, options.extraTitles);
  let [best] = scoreObjections(transcript, options);
  const words = normalizeTranscript(transcript).split(' ').filter(Boolean);
  if (!best?.matched && words.length > LONG_UTTERANCE_WORDS) {
    for (let start = 0; start < words.length - 1; start += 1) {
      // Vetoes also see a few words before the window ("if you | are not interested").
      const vetoContext = words.slice(Math.max(0, start - WINDOW_CONTEXT_WORDS), start + WINDOW_WORDS).join(' ');
      const [candidate] = scoreObjections(words.slice(start, start + WINDOW_WORDS).join(' '), { ...options, vetoContext });
      if (candidate?.matched && (!best?.matched || candidate.score > best.score || (candidate.score === best.score && candidate.priority > best.priority))) best = candidate;
    }
  }
  if (!best?.matched) {
    // Rebuttal titles on the page that no rule covers yet (added on Salebase later).
    const generic = options.onlyTitles || options.extraTitles?.length ? matchGeneric(transcript, options.extraTitles) : null;
    if (!generic) return null;
    const { rule } = generic;
    return { id: rule.id, label: rule.label, titles: rule.titles, phrases: [], score: Math.round(generic.score * 100) / 100, via: 'title', crossScript: true };
  }
  const rule = RULES.find((item) => item.id === best.id);
  // label/phrases are what the Salebase panel lookup uses; titles are every
  // Salebase title that answers this objection, most specific first.
  return { id: rule.id, label: rule.label, titles: titlesFor(rule, normalizeTranscript(transcript)), phrases: rule.phrases, score: best.score, via: best.saved ? 'saved-phrase' : 'fuzzy', crossScript: rule.crossScript !== false };
}

// Test/debug: every given title through the generic matcher, as if no rule knew it.
function matchGenericOnly(transcript, titles) {
  const generic = matchGeneric(transcript, titles, true);
  return generic ? { id: generic.rule.id, label: generic.rule.label, titles: generic.rule.titles, phrases: [], score: generic.score, via: 'title', crossScript: true } : null;
}

// Wraps matchObjection with a short cooldown so one objection said (or
// transcribed) several times in a row only opens its rebuttal once.
export function createObjectionDetector({ cooldownMs = OBJECTION_COOLDOWN_MS, anyCooldownMs = ANY_OBJECTION_COOLDOWN_MS } = {}) {
  const lastById = new Map();
  let lastAny = -Infinity;
  return {
    detect(transcript, now = Date.now(), options = {}) {
      const match = matchObjection(transcript, options);
      if (!match) return { match: null, reason: 'no-match' };
      if (now - (lastById.get(match.id) ?? -Infinity) < cooldownMs) return { match: null, reason: 'cooldown', suppressed: match };
      if (now - lastAny < anyCooldownMs) return { match: null, reason: 'cooldown', suppressed: match };
      lastById.set(match.id, now);
      lastAny = now;
      return { match, reason: 'matched' };
    },
    reset() { lastById.clear(); lastAny = -Infinity; }
  };
}

// Every rebuttal title, so the Salebase page script can tell where one
// rebuttal panel ends and the next begins.
export const REBUTTAL_LABELS = [...new Set(RULES.flatMap((rule) => rule.titles || [rule.label]))];
export const OBJECTION_TITLES = REBUTTAL_LABELS;
export const OBJECTION_RULES = RULES.map(({ id, label, titles, phrases }) => ({ id, label, titles: titles || [label], phrases }));
