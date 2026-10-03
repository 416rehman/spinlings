// Word lists for generated handles (soft-otter-42) and gift codes (quiet-otter-lamp-4821). Meadow,
// kitchen and story words only: nothing rude, nobody else's creatures and nothing from a workshop
// full of computers. A test checks every word against the core name blocklist.

const words = (s: string): readonly string[] => [...new Set(s.trim().split(/\s+/))]

/** First part of a handle. */
export const ADJECTIVES = words(`
  soft quiet sleepy brave misty mossy sunny gentle merry nimble cozy dewy fuzzy plucky rosy snug tiny wispy
  breezy bright calm cheery dapper dreamy fancy fluffy frosty giddy golden happy hazy humble jolly kindly lucky
  lively lofty mellow mighty minty nifty peppy perky polite proud rainy silky silly sleek snowy sparkly speckled
  spry starry stormy steady sugary tidy toasty twinkly velvet wiggly windy witty zesty amber bashful bouncy
  bubbly chirpy cloudy crimson curly dusky feathery gleaming glowing hushed jumpy leafy little lunar mild
  moonlit nutty pebbly puffy shy smiley snoozy sunlit tender woolly zippy balmy brisk crisp fizzy furry gusty
  jaunty peachy plump quaint shiny snappy tufted wavy wild wintry wobbly cuddly drowsy
`)

/** Second part of a handle. */
export const CREATURES = words(`
  otter badger finch wren fox hare newt moth owl robin vole mole toad frog lark heron stoat pika lemur panda
  koala seal puffin swan duck goose crane ferret hedgehog bee snail squirrel chipmunk dormouse marmot beaver
  mink lynx cub pup fawn lamb foal tortoise turtle magpie sparrow starling plover kestrel falcon osprey owlet
  piglet bunny kitten minnow trout carp koi tadpole cricket firefly ladybird dragonfly acorn pebble fern clover
  thistle willow maple birch hazel bramble meadow brook puddle comet star moon petal blossom mushroom truffle
  muffin dumpling biscuit crumpet pudding mitten teacup lantern kettle quill feather capybara quokka wombat
  narwhal axolotl penguin hamster raccoon weasel walrus dolphin yak ibex
`)

/** Gift code words: three are drawn with replacement, so 1200+ words plus 4 digits carry about 44 bits. */
export const GIFT_WORDS = words(`
  otter badger fox hare rabbit bunny vole mole stoat weasel ferret mink marten beaver squirrel chipmunk dormouse
  hamster gerbil mouse shrew hedgehog porcupine possum raccoon skunk lynx bobcat ocelot panther puma cougar
  jaguar leopard tiger lion cheetah wolf coyote jackal dingo hound puppy kitten kitty pony horse donkey mule
  zebra camel yak bison buffalo moose elk deer fawn reindeer caribou antelope gazelle ibex goat sheep lamb ewe
  piglet hog boar calf cow ox bull bear cub panda koala wombat wallaby kangaroo quokka platypus lemur monkey
  gibbon baboon sloth anteater armadillo pangolin aardvark meerkat tapir rhino hippo walrus seal manatee dugong
  dolphin porpoise orca whale narwhal beluga marmot pika capybara chinchilla tamarin okapi bat

  finch wren robin lark owl owlet heron crane stork swan goose duck duckling gosling chick hen rooster quail
  pheasant grouse partridge pigeon dove sparrow starling thrush blackbird magpie jay crow raven rook jackdaw
  kestrel hawk eagle osprey kite buzzard condor puffin gull tern albatross pelican cormorant flamingo ibis egret
  bittern plover lapwing curlew sandpiper snipe kingfisher woodpecker nuthatch warbler swallow linnet siskin
  goldfinch bullfinch chaffinch canary budgie parrot macaw lorikeet toucan hornbill hummingbird penguin kiwi emu
  ostrich dodo chickadee bluebird oriole cardinal tanager waxwing junco wagtail dipper bunting skylark nightjar

  bee bumblebee honeybee wasp hornet ant beetle ladybird firefly glowworm moth caterpillar cricket grasshopper
  cicada dragonfly damselfly mayfly mantis snail slug earthworm spider earwig woodlouse millipede scarab katydid
  lacewing chrysalis cocoon

  minnow trout salmon carp koi pike perch bream tench eel newt toad frog tadpole axolotl salamander turtle
  tortoise terrapin crab lobster shrimp prawn krill clam oyster scallop whelk limpet urchin starfish jellyfish
  octopus squid cuttlefish seahorse stingray manta shark guppy goldfish angelfish pufferfish sunfish sardine
  anchovy herring mackerel haddock halibut plaice tuna marlin swordfish barnacle pearl coral kelp seaweed nautilus

  oak ash elm birch beech maple willow hazel alder aspen poplar larch pine spruce fir cedar yew holly ivy laurel
  olive palm bamboo rowan juniper hawthorn chestnut walnut sycamore linden magnolia acacia baobab banyan redwood
  sequoia mulberry elder hornbeam

  rose tulip daisy lily lotus iris orchid poppy violet pansy peony dahlia aster zinnia marigold sunflower daffodil
  crocus snowdrop bluebell foxglove lavender lilac heather primrose cowslip clover thistle tansy yarrow campion
  mallow hollyhock larkspur lupin cornflower honeysuckle wisteria camellia azalea begonia freesia gardenia
  hyacinth petunia verbena salvia sage thyme rosemary basil mint parsley dill fennel chive sorrel nettle fern moss
  lichen bracken reed sedge bramble gorse heath edelweiss dandelion periwinkle snapdragon bluebonnet anise
  chamomile tarragon oregano borage catnip

  apple pear plum peach apricot cherry berry strawberry raspberry blueberry blackberry gooseberry cranberry
  currant raisin date fig lemon lime orange tangerine clementine mango papaya guava melon watermelon banana
  pineapple coconut lychee persimmon pomegranate quince tomato potato carrot parsnip turnip radish beet onion leek
  garlic shallot pea bean lentil chickpea pumpkin squash marrow gourd zucchini cucumber pickle celery lettuce
  cabbage kale spinach chard sprout broccoli artichoke asparagus corn barley oat wheat rye rice millet acorn
  hazelnut almond pecan cashew pistachio peanut truffle mushroom kumquat nectarine plantain rhubarb yam

  bread muffin crumpet scone biscuit cracker waffle pancake crepe toast honey jam jelly marmalade cheese cream
  custard pudding trifle tart pie cake cupcake brownie fudge toffee caramel candy lolly gumdrop marshmallow
  nougat praline cocoa cinnamon nutmeg ginger vanilla saffron clove pepper paprika sugar syrup treacle sherbet
  sorbet gelato yogurt porridge soup stew broth noodle dumpling pretzel bagel doughnut macaron meringue mochi
  tofu taco pasta ravioli risotto granola popcorn wafer shortbread gingerbread strudel eclair souffle fondue tea
  cider lemonade milk juice biscotti flapjack teacake brioche croissant pastry tartlet sundae parfait lollipop
  licorice bonbon jellybean peppermint candyfloss hotpot cobbler crumble

  sun moon star comet meteor planet galaxy nebula aurora rainbow cloud mist fog haze dew frost snow sleet hail
  rain drizzle storm thunder lightning breeze gale gust wind tempest dawn dusk twilight sunrise sunset noon
  midnight evening morning season summer autumn winter solstice equinox eclipse halo glow glimmer shimmer sparkle
  twinkle beam ray spark flame flicker blaze cinder smoke snowflake raindrop dewdrop starlight moonbeam sunbeam
  stardust moonrise daybreak nightfall

  meadow field glade glen dell vale valley hill hilltop mountain peak summit ridge cliff crag cave cavern grotto
  canyon gorge ravine dune desert oasis prairie tundra forest wood grove copse thicket orchard garden hedge
  hedgerow lane trail bridge ford island isle islet atoll reef lagoon bay cove harbor beach shore coast delta
  marsh swamp bog fen moor pond lake loch river stream brook creek waterfall rapids puddle fountain geyser
  glacier iceberg volcano crater knoll dale burrow nest den hive riverbank seashore hillside woodland moorland

  pebble stone rock boulder flint slate granite marble quartz crystal amber jade opal garnet topaz sapphire
  emerald amethyst agate onyx jasper beryl gold silver copper bronze iron tin pewter obsidian moonstone sunstone

  lantern lamp candle kettle teapot teacup mug cup saucer spoon ladle bowl jar jug basket bucket barrel chest
  trunk drawer shelf cupboard pantry attic cellar porch gate fence chimney hearth stove oven pillow cushion
  blanket quilt rug carpet curtain mirror clock bell whistle drum flute harp lute fiddle banjo ukulele piano
  trumpet tuba cello viola tambourine xylophone kazoo ocarina accordion balloon yoyo puzzle ribbon thimble
  needle wool spindle loom mitten glove scarf hat bonnet cap beret boot slipper sock sandal cloak cape apron
  pocket locket brooch bangle bracelet ring crown tiara compass atlas globe telescope prism wagon cart barrow
  sled sleigh boat raft canoe kayak dinghy yacht ship anchor sail oar paddle rudder buoy lighthouse windmill
  watermill cottage cabin hut tent tower castle palace manor barn stable shed hutch kennel umbrella parasol
  satchel rucksack hammock bookmark postcard teaspoon pinecone seedling

  brave calm cheery cozy dainty dapper dreamy eager fair fancy fluffy fond frosty fuzzy gentle giddy glad golden
  happy hazy humble jolly jumpy keen kind kindly lively lofty lucky mellow merry mighty misty modest mossy nimble
  noble peppy perky plucky polite proud quick quiet rosy rustic silky silly sleepy sleek snowy snug soft sparkly
  speckled spry starry stormy steady sunny sweet tidy tiny toasty twinkly velvet wee wiggly windy wise witty
  woolly zesty zippy azure bashful blithe bouncy breezy bright bubbly chirpy cloudy crimson curly dusky earnest
  feathery gleaming glowing hushed leafy little lunar mild moonlit nutty pebbly puffy rustling shy smiley snoozy
  sprightly sunlit tender balmy brisk crisp dewy dusty fresh frothy gilded glossy grassy hardy hearty hoppy icy
  jaunty lacy lush minty muddy nifty patient peachy pink plump prim quaint rainy ruddy salty sandy scarlet shaggy
  shiny smoky snappy spicy stout sugary tangy tufted wavy wild wintry wobbly cuddly fizzy furry gusty radiant
  serene tranquil vivid warm cool drowsy

  red yellow green blue indigo purple ivory russet ochre umber sienna sepia tan beige khaki cyan aqua turquoise
  navy cobalt cerulean mauve magenta charcoal teal mustard

  whisper giggle wiggle wobble tumble bumble ramble wander amble meander frolic gambol caper prance skip hop leap
  bounce twirl spin swirl drift glide float flutter nibble munch sip snooze doze nap dream wish hope cheer hum sing
  chirp purr hoot coo quack honk bleat moo neigh squeak splash sprinkle rustle tiptoe cartwheel

  song tune melody rhyme verse ode ballad lullaby carol chorus echo riddle fable tale legend myth saga story poem
  charm spell rune potion elixir amulet talisman trinket bauble treasure jewel gem wand cauldron

  dragon griffin unicorn pegasus phoenix sprite pixie fairy elf goblin ogre giant imp kelpie selkie dryad nymph
  wisp yeti kraken hydra wyvern sphinx mermaid brownie boggart
`)
