"""Authoring candidates only: publish a word after confirming original-video evidence."""

# group, default kind, semicolon-separated candidates. Original OCR/transcript and
# visual review decide the final inventory; this list alone never publishes a quiz.
LESSONS = {
  1: ('numbers', 'number', 'one;two;three;four;five;six;seven;eight;nine;ten'),
  2: ('animals', 'noun', 'bear;leopard;penguin;pig;giraffe;turtle;bee;chicken;duck;goat;sheep;fox;monkey;hippopotamus;polar bear;eagle'),
  3: ('food', 'noun', 'tomato;cucumber;eggplant;potatoes;onion;carrot;lettuce;celery;corn;green beans;pumpkin;peas;peppers;radish;salad;apple;peach;lemon;lime;orange;strawberries;pineapple;raspberries;bananas;blueberries;cherries;grapes;pear;plum'),
  4: ('people', 'noun', 'school;flag;bell;teacher;classroom;locker;lunch box;map;calendar;desk;book bag;backpack;notebook;paper;pen;pencil;eraser;book;blackboard;chalk;globe;crayons;brush;paint'),
  5: ('numbers', 'number', 'eleven;twelve;thirteen;fourteen;fifteen;sixteen;seventeen;eighteen;nineteen;twenty'),
  6: ('play', 'noun', 'clown;musician;firefighter;doctor;police officer;artist;letter carrier;ballerina;dentist;carpenter;airline pilot;builder;plumber;farmer;veterinarian;taxi driver;nurse;teacher;scientist;astronaut'),
  7: ('people', 'body', 'body;head;forehead;ear;eye;eyebrow;eyelashes;nose;cheek;mouth;chin;hair;bangs;lips;teeth;tongue;neck;back;chest;arm;elbow;hand;finger;fingernail;leg;knee;foot;toes;mustache;beard'),
  8: ('world', 'position', 'up;down;in;inside;out;outside;on top of;under;in front of;behind;between'),
  9: ('world', 'noun', 'garden;grass;tree;bush;wheelbarrow;hoe;rake;shovel;flower pot;trowel;soil;seeds;watering can;flowers'),
 10: ('play', 'sport', 'tennis;tennis racket;tennis ball;baseball;baseball bat;soccer;football;basketball;hockey;ice skating;ice skates;rugby;skateboard;swimming;gymnastics;skiing;skis;snowboard'),
 11: ('world', 'time', "clock;seven o'clock;quarter past seven;half past seven;quarter to eight;eight o'clock;breakfast;morning;midday;one o'clock;lunch;afternoon;evening;dinner;night;midnight"),
 12: ('home', 'noun', 'house;roof;chimney;shutters;window;door;porch;steps;living room;fireplace;television;remote control;DVD player;stereo;speakers;radio;video;sofa;newspaper;magazine;computer;telephone;carpet;dining room;table;plate;fork;knife;spoon;cup;glass;napkin;chair;curtains;stairs;laptop computer;keyboard;printer;flash drive;tablet;bathroom;toilet;shower;bath;toothbrush;toothpaste;soap;mirror;sink;washbasin;towel;bedroom;wardrobe;closet;dresser;dressing table;hairbrush;comb;bed;pillow;blanket;sheets;stepladder;attic;cellar;kitchen;washing machine;dryer;refrigerator;fridge;stove;oven;microwave;toaster;blender;dishwasher;saucepan;apron;brush;dustpan;ironing board;iron;bucket;sewing machine;jug;pitcher;faucet;tap;trash can;garbage can;camera;vacuum cleaner'),
 13: ('numbers', 'shape', 'circle;square;triangle;diamond;oval;rectangle;star;heart;brown;pink;purple;orange;blue;yellow;green;red;black;white'),
 14: ('play', 'noun', 'drums;piano;cymbals;guitar;violin;cello;flute;clarinet;oboe;bassoon;trumpet;trombone;tuba;French horn;saxophone;harmonica;accordion'),
 15: ('play', 'noun', 'ball;tennis racket;roller skates;sled;ice skates;skis;dollhouse;doll;teddy bear;cards;balloon;kite;baseball bat;sandbox;bucket;shovel;blocks;puzzle;video game'),
 16: ('home', 'noun', 'tie;jacket;pants;shirt;underpants;undershirt;socks;hanger;underwear;blouse;sweater;skirt;slippers;shoes;boots;sneakers;coat;raincoat;belt;scarf;hat;gloves;handbag;umbrella;bathing suit;shorts;sandals;T-shirt;jeans;robe;pajamas;dress;watch;earring;ring;bracelet;pin;necklace;keys;glasses;wallet;coins;bills;credit card;batteries;cell phone'),
 17: ('numbers', 'number', 'twenty-one;twenty-two;twenty-three;twenty-four;twenty-five;twenty-six;twenty-seven;twenty-eight;twenty-nine;thirty'),
 18: ('food', 'food', 'pizza;French fries;hamburger;chicken;cereal;ham;pie;bread;butter;jam;peanut butter;cheese;pepper;salt;sandwich;cake;candy;cookies;ice cream;milk;tea;sugar;coffee;juice;soft drink;spaghetti;rice;eggs;hot dog;fish;water;yogurt'),
 19: ('people', 'person', 'man;woman;friend;husband;wife;baby;twins;boy;girl;son;daughter;father;mother;brother;sister;grandma;grandpa'),
 20: ('world', 'noun', 'tire;trunk;hood;engine;wheel;door;seat;steering wheel;windshield;windshield wipers;headlights;mirror;horn;GPS navigator;gas station;gas pump'),
 21: ('world', 'noun', 'wood;saw;power saw;nails;hammer;screw;screwdriver;cordless drill;ruler;rope;pliers;wrench;scissors'),
 22: ('world', 'direction', 'north;south;east;west;left;right;straight ahead'),
 23: ('world', 'place', 'town;highway;street;traffic light;parking meter;parking lot;gas station;bank;hospital;theater;movie theater;restaurant;park;police station;supermarket;fire station;swimming pool;school;coffee shop;stadium;circus;zoo;shopping mall;skyscraper;train station;taxi stand;bus station;airport'),
 24: ('numbers', 'number', 'thirty-one;thirty-six;forty;fifty;sixty;seventy;eighty;ninety;ninety-nine;one hundred'),
 25: ('world', 'vehicle', 'baby carriage;bicycle;scooter;wagon;motorcycle;taxi;car;bus;truck;ambulance;fire engine;dump truck;bulldozer;train;boat;yacht;submarine;balloon;helicopter;airplane;rocket;spaceship'),
 26: ('world', 'noun', 'tree;tent;sky;sun;cloud;rain;fog;snow;mountain;lake;beach;sea;moon;star'),
 27: ('animals', 'noun', 'cage;kangaroo;tiger;camel;ladybug;bird;collar;rabbit;mouse;lion;dog;puppy;fish tank;zebra;horse;pony;butterfly;elephant;fish;basket;peacock;cow;calf;kitten;cat;leash;snake;bull;spider;rhinoceros;ant;dinosaur;horns;claws;paws;wing;wings;feathers;tail;whiskers;hamster;parrot;squirrel;gorilla;crocodile;alligator;deer;donkey;ostrich;octopus;shark;whale;dolphin'),
 28: ('numbers', 'number', 'one hundred;one hundred ten;one hundred twenty;one thousand;ten thousand;one hundred thousand;one million'),
}

COLORS=set('brown pink purple orange blue yellow green red black white'.split())
PLURALS=set('eyelashes lips teeth toes bangs shutters steps speakers curtains stairs sheets pants underpants socks slippers shoes boots sneakers shorts sandals jeans pajamas earrings glasses keys coins bills batteries drums cymbals cards skis blocks crayons nails pliers scissors potatoes peas peppers strawberries raspberries bananas blueberries cherries grapes eggs twins horns claws paws wings feathers whiskers seeds flowers'.split())|{'green beans','French fries','roller skates','ice skates','windshield wipers','headlights'}
MASS={'rain','snow','fog','grass','soil','wood','underwear','jam','butter','cheese','milk','tea','sugar','coffee','juice','pepper','salt','cereal','ham','bread','peanut butter','ice cream','spaghetti','rice','water','yogurt','paint','chalk','paper','toothpaste','soap','hair','lettuce','celery','corn','salad','candy'}
NUMBER_VALUES={
 'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,'nine':9,'ten':10,
 'eleven':11,'twelve':12,'thirteen':13,'fourteen':14,'fifteen':15,'sixteen':16,'seventeen':17,'eighteen':18,'nineteen':19,'twenty':20,
 'twenty-one':21,'twenty-two':22,'twenty-three':23,'twenty-four':24,'twenty-five':25,'twenty-six':26,'twenty-seven':27,'twenty-eight':28,'twenty-nine':29,'thirty':30,
 'thirty-one':31,'thirty-six':36,'forty':40,'fifty':50,'sixty':60,'seventy':70,'eighty':80,'ninety':90,'ninety-nine':99,'one hundred':100,
 'one hundred ten':110,'one hundred twenty':120,'one thousand':1000,'ten thousand':10000,'one hundred thousand':100000,'one million':1000000,
}
