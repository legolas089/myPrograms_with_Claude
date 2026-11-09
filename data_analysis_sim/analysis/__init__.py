"""Analysis engine for the Data Analysis Simulator.

Each module is a plain function library on NumPy/SciPy arrays, independent of
Flask, so it can be imported from a notebook or a script as well:

    synth        seeded synthetic data (distribution + optional time structure)
    descriptive  location / spread / moments / quantiles
    density      histogram, binned Gaussian KDE, box-plot statistics
    jsonsafe     NaN/inf-safe conversion of results to JSON
"""
